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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

/**
 * @notice An MVP contract which can initialize a pool and add/remove liquidity
 */
contract LiquidityProvider {
    IVault internal immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    /**
     * @dev This helper function is a fast and cheap way to convert between IERC20[] and IAsset[] types
     */
    function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            assets := tokens
        }
    }

    /**
     * This function demonstrates how to initialize a pool as the first liquidity provider
     */
    function initializePool(bytes32 poolId) public {
        // Some pools can change which tokens they hold so we need to tell the Vault what we expect to be adding.
        // This prevents us from thinking we're adding 100 DAI but end up adding 100 BTC!
        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(poolId);
        IAsset[] memory assets = _convertERC20sToAssets(tokens);

        // These are the slippage limits preventing us from adding more tokens than we expected.
        // If the pool trys to take more tokens than we've allowed it to then the transaction will revert.
        uint256[] memory maxAmountsIn = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            maxAmountsIn[i] = type(uint256).max;
        }

        // There are several ways to add liquidity and the userData field allows us to tell the pool which to use.
        // Here we're encoding data to tell the pool we're adding the initial liquidity
        // Balancer.js has several functions can help you create your userData.
        bytes memory userData = "0x";

        // We can ask the Vault to use the tokens which we already have on the vault before using those on our address
        // If we set this to false, the Vault will always pull all the tokens from our address.
        bool fromInternalBalance = false;

        // We need to create a JoinPoolRequest to tell the pool how we we want to add liquidity
        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: assets,
            maxAmountsIn: maxAmountsIn,
            userData: userData,
            fromInternalBalance: fromInternalBalance
        });

        // We can tell the vault where to take tokens from and where to send BPT to
        // If you don't have permission to take the sender's tokens then the transaction will revert.
        // Here we're using tokens held on this contract to provide liquidity and forward the BPT to msg.sender
        address sender = address(this);
        address recipient = msg.sender;

        _vault.joinPool(poolId, sender, recipient, request);
    }

    /**
     * This function demonstrates how to add liquidity to an already initialized pool
     * It's very similar to the initializePool except we provide different userData
     */
    function joinPool(bytes32 poolId) public {
        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(poolId);

        uint256[] memory maxAmountsIn = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            maxAmountsIn[i] = type(uint256).max;
        }

        // Now the pool is initialized we have to encode a different join into the userData
        bytes memory userData = "0x";

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _convertERC20sToAssets(tokens),
            maxAmountsIn: maxAmountsIn,
            userData: userData,
            fromInternalBalance: false
        });

        address sender = address(this);
        address recipient = msg.sender;
        _vault.joinPool(poolId, sender, recipient, request);
    }

    /**
     * This function demonstrates how to remove liquidity from a pool
     */
    function exitPool(bytes32 poolId) public {
        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(poolId);

        // Here we're giving the minimum amounts of each token we'll accept as an output
        // For simplicity we're setting this to all zeros
        uint256[] memory minAmountsOut = new uint256[](tokens.length);

        // We can ask the Vault to keep the tokens we receive in our internal balance to save gas
        bool toInternalBalance = false;

        // As we're exiting the pool we need to make an ExitPoolRequest instead
        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest({
            assets: _convertERC20sToAssets(tokens),
            minAmountsOut: minAmountsOut,
            userData: "0x",
            toInternalBalance: toInternalBalance
        });

        address sender = address(this);
        address payable recipient = msg.sender;
        _vault.exitPool(poolId, sender, recipient, request);
    }
}
