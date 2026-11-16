// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {X202Oracle} from "../X202Oracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Example consumer: pays the fee, reads the latest report of a company, keeps what it read.
contract ReaderAgent {
    X202Oracle public immutable oracle;
    uint128 public lastRevenueUsd;
    int64 public lastEpsGaapE4;
    bytes16 public lastPeriod;
    uint256 public lastId;

    event Consumed(uint256 id, bytes16 period, uint128 revenueUsd, int64 epsGaapE4);

    constructor(X202Oracle o) { oracle = o; }

    function approvePayment(IERC20 token, uint256 amount) external { token.approve(address(oracle), amount); }

    function consume(uint256 id) external {
        X202Oracle.Report memory r = oracle.read(id);
        lastId = id; lastRevenueUsd = r.revenueUsd; lastEpsGaapE4 = r.epsGaapE4; lastPeriod = r.period;
        emit Consumed(id, r.period, r.revenueUsd, r.epsGaapE4);
    }
}
