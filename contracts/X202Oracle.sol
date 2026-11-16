// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title x202 — quarterly earnings from SEC 8-K Item 2.02 filings, onchain.
/// @notice A writer posts each report a few seconds after the SEC accepts the filing.
///         Contracts read it with read(), paying a fee in the payment token; part of it is burned.
///         Before a payment token is set, reads are free.
interface IBurnableToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

contract X202Oracle {
    struct Report {
        uint32 cik;               // SEC company id
        bytes16 ticker;           // e.g. "NVDA"
        bytes16 period;           // e.g. "Q3 FY2027"
        uint128 revenueUsd;       // whole dollars
        int64 epsGaapE4;          // diluted GAAP EPS x 10^4
        int64 epsAdjE4;           // diluted non-GAAP EPS x 10^4 (0 when not confirmed)
        uint128 guidanceRevenueUsd; // next-quarter revenue outlook, whole dollars (0 when not confirmed)
        uint64 secAcceptedAt;     // unix seconds, SEC acceptance time
        uint64 onchainAt;         // unix seconds, block time of this write
        bytes20 accession;        // "0001045810-26-000073" without dashes, ASCII
    }

    address public owner;
    address public writer;
    IBurnableToken public paymentToken;   // set once, at launch
    address public treasury;
    uint256 public readFee;                // in payment token units
    uint16 public burnBps;                 // share of each fee that is burned (10000 = 100%)
    /// @notice true when the token has no burn(): the burned share goes to the dead address, out of circulation for good.
    bool public burnToDead;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    Report[] private reports;
    mapping(bytes20 => uint256) public idByAccession; // id + 1, 0 = unknown
    mapping(uint32 => uint256) public latestIdByCik;   // id + 1, 0 = unknown
    uint256 public totalReads;
    uint256 public totalBurned;

    event EarningsPublished(uint256 indexed id, uint32 indexed cik, bytes16 ticker, bytes16 period, uint64 secAcceptedAt, uint64 onchainAt, bytes20 accession);
    event EarningsRead(uint256 indexed id, address indexed reader, uint256 fee, uint256 burned);
    event WriterChanged(address writer);
    event PaymentSet(address token, address treasury, uint256 fee, uint16 burnBps, bool burnToDead);
    event OwnerChanged(address owner);

    error NotOwner();
    error NotWriter();
    error AlreadyPublished();
    error UnknownReport();
    error BadConfig();
    error PaymentFailed();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(address writer_) {
        owner = msg.sender;
        writer = writer_;
        emit WriterChanged(writer_);
    }

    // ---------- admin ----------
    function setWriter(address w) external onlyOwner { writer = w; emit WriterChanged(w); }
    function transferOwnership(address o) external onlyOwner { if (o == address(0)) revert BadConfig(); owner = o; emit OwnerChanged(o); }

    /// @notice Plug the payment token (once). Fee and burn share stay adjustable.
    function setPayment(address token, address treasury_, uint256 fee, uint16 burnBps_, bool burnToDead_) external onlyOwner {
        if (burnBps_ > 10_000 || treasury_ == address(0) || token == address(0)) revert BadConfig();
        if (address(paymentToken) != address(0) && token != address(paymentToken)) revert BadConfig();
        paymentToken = IBurnableToken(token);
        treasury = treasury_;
        readFee = fee;
        burnBps = burnBps_;
        burnToDead = burnToDead_;
        emit PaymentSet(token, treasury_, fee, burnBps_, burnToDead_);
    }

    // ---------- write ----------
    function publish(
        uint32 cik, bytes16 ticker, bytes16 period,
        uint128 revenueUsd, int64 epsGaapE4, int64 epsAdjE4, uint128 guidanceRevenueUsd,
        uint64 secAcceptedAt, bytes20 accession
    ) external returns (uint256 id) {
        if (msg.sender != writer) revert NotWriter();
        if (idByAccession[accession] != 0) revert AlreadyPublished();
        id = reports.length;
        reports.push(Report(cik, ticker, period, revenueUsd, epsGaapE4, epsAdjE4, guidanceRevenueUsd, secAcceptedAt, uint64(block.timestamp), accession));
        idByAccession[accession] = id + 1;
        // Only move "latest" forward: back-filled older quarters never replace a newer one.
        uint256 prev = latestIdByCik[cik];
        if (prev == 0 || reports[prev - 1].secAcceptedAt < secAcceptedAt) latestIdByCik[cik] = id + 1;
        emit EarningsPublished(id, cik, ticker, period, secAcceptedAt, uint64(block.timestamp), accession);
    }

    // ---------- read (paid) ----------
    function read(uint256 id) public returns (Report memory r) {
        if (id >= reports.length) revert UnknownReport();
        _charge(id);
        return reports[id];
    }

    function readLatest(uint32 cik) external returns (Report memory) {
        uint256 v = latestIdByCik[cik];
        if (v == 0) revert UnknownReport();
        return read(v - 1);
    }

    function _charge(uint256 id) internal {
        totalReads++;
        uint256 fee = readFee;
        if (address(paymentToken) == address(0) || fee == 0) { emit EarningsRead(id, msg.sender, 0, 0); return; }
        uint256 burned = (fee * burnBps) / 10_000;
        if (!paymentToken.transferFrom(msg.sender, address(this), fee)) revert PaymentFailed();
        if (burned > 0) { if (burnToDead) _send(DEAD, burned); else paymentToken.burn(burned); }
        if (fee > burned) _send(treasury, fee - burned);
        totalBurned += burned;
        emit EarningsRead(id, msg.sender, fee, burned);
    }

    function _send(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(paymentToken).call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert PaymentFailed();
    }

    // ---------- free metadata (no numbers) ----------
    function count() external view returns (uint256) { return reports.length; }
}
