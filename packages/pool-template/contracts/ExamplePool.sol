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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IGeneralPool.sol";
import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";

/**
 * @dev Our example pool inherits from IGeneralPool and BasePool.
 *
 * Pools have "specializations," which affect how balances are stored and processed during swaps for maximum efficiency.
 * The possibilities are TwoToken, MinimalSwapInfo, and General: and there are two interfaces:
 * IMinimalSwapInfoPool and IGeneralPool (TwoToken uses IMinimalSwapInfoPool)
 *
 * If, according to the AMM logic, a pool can perform a swap knowing only the balances of tokens involved in the swap,
 * it can use the cheaper IMinimalSwapInfoPool interface. Otherwise, if all balances are required, it must use
 * IGeneralPool.
 *
 * BasePool is IBasePool, BasePoolAuthorization, BalancerPoolToken, TemporarilyPausable
 * `IBasePool` simply defines the join/exit hooks (needed to add and remove liquidity from a pool)
 * `BasePoolAuthorization` stores the "owner" of a pool, and can be customized to add new permissioned functions that
 * can only be executed by the owner. Any other calls are referred to the Vault's Authorizer (i.e., Balancer
 * governance).
 * `BalancerPoolToken` is the token contract representing shares of the pool. Adding liquidity mints BPTs (pool tokens),
 * and removing liquidity burns them.
 * `TemporarilyPausable` is a safety measure that lets Balancer governance "pause" a pool during an initial period after
 * deployment of the factory. In general, if a pool is paused, all operations revert except proportional exits.
 */
contract ExamplePool is IGeneralPool, BasePool {
    // solhint-disable no-empty-blocks
    // For highest precision, arithmetic in Balancer is generally fixed point, where 1.0 = 1e18. 0.01 = 1e16, etc.
    using FixedPoint for uint256;

    // We are creating a pool that can have either 2 or 3 tokens
    uint256 private constant _MAX_TOKENS = 3;

    // Tokens are registered once, and will not change, so the count can be immutable
    // Immutable variables are set in the creationCode, and are cheap to access at runtime (no storage reads)
    uint256 private immutable _totalTokens;

    // Store the token addresses - _token2 will be 0 if this is a 2-token pool
    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    IERC20 internal immutable _token2;

    // Vault accounting behaves as though all tokens had 18 decimals, though all I/O operations operate using the
    // native token decimals. Therefore, we need to "upscale" balances when sending them to the Vault for calculations,
    // and then "downscale" the result for output. BasePool has utilities for scaling both individual values and arrays.
    // The scaling functions also control the rounding direction, to prevent any rounding-based attacks. Tokens leaving
    // the Vault are rounded down, and tokens entering the Vault are rounded up. Therefore any rounding errors will
    // necessarily favor the Pool/Vault over the caller.
    //
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.
    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.GENERAL,
            name,
            symbol,
            tokens,
            new address[](tokens.length), // do not allow asset managers
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        // Set the immutable variables
        _totalTokens = tokens.length;

        _token0 = tokens[0];
        _token1 = tokens[1];
        _token2 = tokens[2];

        _scalingFactor0 = _computeScalingFactor(tokens[0]);
        _scalingFactor1 = _computeScalingFactor(tokens[1]);
        _scalingFactor2 = _computeScalingFactor(tokens[2]);
    }

    // Getters / Setters

    function _getTotalTokens() internal view override returns (uint256) {
        return _totalTokens;
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _MAX_TOKENS;
    }

    // Swap hooks

    // When someone calls `swap` or `batchSwap` on the Vault, it formulates the correct arguments and calls the
    // `onSwap` pool callback, updating the Vault accounting based on the results.
    //
    // BaseGeneralPool has an implementation of `onSwap` which handles swap fee calculation and up/downscaling.
    // If this is sufficient, you could inherit BaseGeneralPool and implement the lower level `_onSwapGivenIn` and
    // `_onSwapGivenOut` functions (for "price quotes")
    //
    // Note that because this pool has the General specialization, the swap function needs the full array of
    // token balances
    //
    // Override this highest level if you need to do something different
    function onSwap(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public virtual override onlyVault(request.poolId) returns (uint256) {}

    // Join Hooks

    // This must be implemented at pool level, since each pool type is in charge of how it handles pool participation.
    // This can only be called once, after the pool is registered, as the first join: when the totalSupply is 0.
    // Pool-type-dependent information (usually initial balances) can be passed in through userData.
    // In general, this function should calculate the actual token amounts the Vault should pull in from sender
    // (accounting for fees, etc.), and the BPT that should be minted.
    function _onInitializePool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal view override whenNotPaused returns (uint256 bptAmountOut, uint256[] memory amountsIn) {}

    // Calling `joinPool` on the Vault formulates the correct arguments based on the specialiation, and calls the
    // pool's `onJoinPool` hook. BasePool has an implementation of this that mints an initial amount of BPT to
    // address 0 if this is the first join - also calling the `_onInitializePool` hook - or if this is someone adding
    // liquidity, handle scaling and minting operations, delegating the price quoting to the `_onJoinPool` hook.
    //
    // This function should calculate the actual token amounts that should be pulled in, the amount of BPT that should
    // be minted, and the amount of protocol fees (which will be sent to the ProtocolFeeColllector contract outside the
    // Vault).
    function _onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        pure
        override
        returns (
            uint256 bptAmountOut,
            uint256[] memory amountsIn,
            uint256[] memory dueProtocolFeeAmounts
        )
    {}

    // Exit Hook

    // Calling `exitPool` on the Vault formulates the correct arguments based on the specialiation, and calls the
    // pool's `onExitPool` hook. BasePool has an implementation of this that handles scaling and burning operations,
    // delegating the price quoting to the `_onExitPool` hook.
    //
    // This function should calculate the actual token amounts that should be withdrawn, the amount of BPT that should
    // be burned, and the amount of protocol fees (which will be sent to the ProtocolFeeColllector contract outside the
    // Vault).
    function _onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        override
        returns (
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        )
    {}

    // Scaling

    /**
     * @dev Returns the scaling factor for one of the Pool's tokens.
     */
    function _scalingFactor(uint256 index) internal view returns (uint256) {
        if (index == 0) return _scalingFactor0;
        if (index == 1) return _scalingFactor1;
        return _scalingFactor2;
    }

    /**
     * @dev Returns the scaling factor for one of the Pool's tokens. Reverts if `token` is not a token registered by the
     * Pool.
     */
    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        if (token == _token0) { return _scalingFactor0; }
        else if (token == _token1) { return _scalingFactor1; }
        else if (token == _token2) { return _scalingFactor2; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    /**
     * @dev Same as `_scalingFactor()`, except for all registered tokens (in the same order as registered). The Vault
     * will always pass balances in this order when calling any of the Pool hooks.
     */
    function _scalingFactors() internal view override returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](_getTotalTokens());

        scalingFactors[0] = _scalingFactor0;
        scalingFactors[1] = _scalingFactor1;
        scalingFactors[2] = _scalingFactor2;

        return scalingFactors;
    }
}
