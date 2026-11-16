// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test only: a token with no burn(), like many launch-platform tokens.
contract PlainToken is ERC20 {
    constructor() ERC20("plain test token", "PLAIN") { _mint(msg.sender, 1_000_000e18); }
}
