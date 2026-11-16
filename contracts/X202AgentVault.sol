// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IX202Oracle {
    function paymentToken() external view returns (address);
    function readFee() external view returns (uint256);
    function count() external view returns (uint256);
    function read(uint256 id) external; // the report it returns is not needed here
}

/// @title x202 agent vault — people arm their Telegram agent with a token deposit.
/// @notice An agent is armed while its deposit covers one x202 read. When a report it follows lands,
///         the bot (operator) fires it: the vault pays one x202 read with the agent's deposit
///         (the fee is burned by the oracle) and the bot sends the alert right away.
///         Guarantees, enforced here and not by trust in the bot:
///         - the operator can charge an agent at most once per published report, never more than the read fee;
///         - the operator and the owner can never take a deposit: only the depositor withdraws it, at any time.
contract X202AgentVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IX202Oracle public immutable oracle;
    address public owner;
    address public operator;

    mapping(bytes32 => address) public depositorOf;   // agent key -> wallet that funded it (set by the first deposit)
    mapping(bytes32 => uint256) public balanceOf;     // agent key -> tokens left
    mapping(bytes32 => mapping(uint256 => bool)) public fired; // agent key -> report id -> already paid
    uint256 public totalFired;

    event Deposited(bytes32 indexed key, address indexed from, uint256 amount, uint256 balance);
    event Withdrawn(bytes32 indexed key, address indexed to, uint256 amount, uint256 balance);
    event Fired(bytes32 indexed key, uint256 indexed reportId, uint256 fee, uint256 balance);
    event Skipped(bytes32 indexed key, uint256 indexed reportId, uint8 reason); // 1 already fired, 2 not enough deposit
    event OperatorChanged(address operator);
    event OwnerChanged(address owner);

    error NotOwner();
    error NotOperator();
    error NotDepositor();
    error NoToken();
    error ZeroAmount();
    error TooMuch();
    error UnknownReport();
    error BadConfig();

    constructor(IX202Oracle oracle_, address operator_) {
        if (address(oracle_) == address(0) || operator_ == address(0)) revert BadConfig();
        oracle = oracle_;
        owner = msg.sender;
        operator = operator_;
        emit OperatorChanged(operator_);
        emit OwnerChanged(msg.sender);
    }

    // ---------- admin (cannot touch deposits) ----------
    function setOperator(address o) external {
        if (msg.sender != owner) revert NotOwner();
        if (o == address(0)) revert BadConfig();
        operator = o;
        emit OperatorChanged(o);
    }

    function transferOwnership(address o) external {
        if (msg.sender != owner) revert NotOwner();
        if (o == address(0)) revert BadConfig();
        owner = o;
        emit OwnerChanged(o);
    }

    function token() public view returns (IERC20) {
        address t = oracle.paymentToken();
        if (t == address(0)) revert NoToken();
        return IERC20(t);
    }

    // ---------- people ----------
    /// @notice Fund (arm) an agent. The first deposit binds the agent key to the sender's wallet.
    function deposit(bytes32 key, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        address d = depositorOf[key];
        if (d == address(0)) depositorOf[key] = msg.sender;
        else if (d != msg.sender) revert NotDepositor();
        IERC20 t = token();
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = t.balanceOf(address(this)) - before; // tokens with a transfer tax credit what arrived
        balanceOf[key] += received;
        emit Deposited(key, msg.sender, received, balanceOf[key]);
    }

    /// @notice Take back what is left, at any time. Only the wallet that funded the agent.
    function withdraw(bytes32 key, uint256 amount) external nonReentrant {
        if (depositorOf[key] != msg.sender) revert NotDepositor();
        if (amount == 0) revert ZeroAmount();
        if (amount > balanceOf[key]) revert TooMuch();
        balanceOf[key] -= amount;
        token().safeTransfer(msg.sender, amount);
        emit Withdrawn(key, msg.sender, amount, balanceOf[key]);
    }

    function isArmed(bytes32 key) public view returns (bool) {
        if (oracle.paymentToken() == address(0)) return false;
        uint256 fee = oracle.readFee();
        return balanceOf[key] >= fee && balanceOf[key] > 0;
    }

    /// @notice How many alerts the current deposit pays for.
    function alertsLeft(bytes32 key) external view returns (uint256) {
        if (oracle.paymentToken() == address(0)) return 0;
        uint256 fee = oracle.readFee();
        return fee == 0 ? type(uint256).max : balanceOf[key] / fee;
    }

    // ---------- bot ----------
    /// @notice Pay one x202 read per agent for this report. Agents already fired or without enough deposit are skipped.
    /// @return paid how many agents were charged
    function fire(bytes32[] calldata keys, uint256 reportId) external nonReentrant returns (uint256 paid) {
        if (msg.sender != operator) revert NotOperator();
        if (reportId >= oracle.count()) revert UnknownReport();
        IERC20 t = token();
        uint256 fee = oracle.readFee();
        for (uint256 i; i < keys.length; i++) {
            bytes32 k = keys[i];
            if (fired[k][reportId]) { emit Skipped(k, reportId, 1); continue; }
            if (balanceOf[k] < fee || balanceOf[k] == 0) { emit Skipped(k, reportId, 2); continue; }
            fired[k][reportId] = true;
            balanceOf[k] -= fee;
            if (fee > 0) t.forceApprove(address(oracle), fee);
            oracle.read(reportId); // pulls exactly the fee and burns it
            paid++;
            emit Fired(k, reportId, fee, balanceOf[k]);
        }
        totalFired += paid;
    }
}
