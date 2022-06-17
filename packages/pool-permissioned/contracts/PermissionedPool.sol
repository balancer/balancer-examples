// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-pool-weighted/contracts/WeightedPool.sol";
import "./interfaces/IPermissionedPool.sol";
import "./interfaces/IPermissionedRegistry.sol";

/**
 * @dev PermissionedPool with an allowlist
 */
contract PermissionedPool is IPermissionedPool, WeightedPool {
    bytes32 private immutable _allowlistId;
    IPermissionedRegistry private immutable _allowlistRegistry;

    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20[] tokens;
        uint256[] normalizedWeights;
        address[] assetManagers;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        address owner;
        address allowlistRegistry;
        bytes32 allowlistId;
    }

    constructor(NewPoolParams memory params)
        WeightedPool(
            params.vault,
            params.name,
            params.symbol,
            params.tokens,
            params.normalizedWeights,
            params.assetManagers,
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        _allowlistId = params.allowlistId;
        _allowlistRegistry = IPermissionedRegistry(params.allowlistRegistry);
    }

    /**
     * @dev Verifies that a given address is allowed to hold tokens.
     */
    function canReceiveBPT(address member, uint256) public view override returns (bool) {
        if (member == address(0)) return true;
        return _allowlistRegistry.isAllowlisted(_allowlistId, member);
    }

    /**
     * @dev Verifies that a given address is allowed to swap tokens
     */
    function isAllowedSwap(SwapRequest memory swapRequest) public view override returns (bool) {
        return
            _allowlistRegistry.isAllowlisted(_allowlistId, swapRequest.from) &&
            _allowlistRegistry.isAllowlisted(_allowlistId, swapRequest.to);
    }

    /**
     * @dev Override _beforeTokenTransfer to limit transfers of bpt
     */
    function _beforeTokenTransfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal virtual override {
        require(canReceiveBPT(recipient, amount), "Invalid bpt recipient");
        return super._beforeTokenTransfer(sender, recipient, amount);
    }

    /**
     * @dev Override _onJoinPool to remove protocolFees
     */
    function _onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256, // protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        virtual
        override
        whenNotPaused
        returns (
            uint256 bptAmountOut,
            uint256[] memory amountsIn,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        return super._onJoinPool(poolId, sender, recipient, balances, lastChangeBlock, 0, scalingFactors, userData);
    }

    /**
     * @dev Override _onExitPool to remove protocolFees
     */
    function _onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256, // protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        virtual
        override
        returns (
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        return super._onExitPool(poolId, sender, recipient, balances, lastChangeBlock, 0, scalingFactors, userData);
    }

    /**
     * @dev Override _onExitPool to remove protocolFees
     */
    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view virtual override whenNotPaused returns (uint256) {
        require(isAllowedSwap(swapRequest), "Swap not allowed");
        return super._onSwapGivenIn(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view virtual override whenNotPaused returns (uint256) {
        require(isAllowedSwap(swapRequest), "Swap not allowed");
        return super._onSwapGivenOut(swapRequest, currentBalanceTokenIn, currentBalanceTokenOut);
    }
}
