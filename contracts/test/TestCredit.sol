// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Test network only. Free-mint credit used to exercise paid reads before the real token exists.
contract TestCredit is ERC20, ERC20Burnable {
    constructor() ERC20("x202 test credit", "TEST") {}
    function faucet(uint256 amount) external { require(amount <= 1_000_000e18, "too much"); _mint(msg.sender, amount); }
}
