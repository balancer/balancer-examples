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
import "@balancer-labs/v2-pool-weighted/contracts/WeightedPoolUserDataHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

/**
 * @dev CharityPool is a pool that pays out to a chairty
 */
contract CharityPool is WeightedPool {
    address private immutable _charity;

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
        address charity;
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
        _charity = params.charity;
    }

    // pool holds the fees it collects
    function payProtocolFees(uint256 bptAmount) internal {
        _mintPoolTokens(address(this), bptAmount);
    }

    // anyone can pay tokens out to charity
    function payoutToCharity() public {
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(getPoolId());
        uint256[] memory minAmountsOut = new uint256[](tokens.length);
        uint256 bptIn = balanceOf(address(this));
        uint256 exitKind = 2; // WeightedPoolUserDataHelpers.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT

        getVault().exitPool(
            getPoolId(),
            address(this),
            payable(_charity),
            IVault.ExitPoolRequest({
                assets: _translateToIAsset(tokens),
                minAmountsOut: minAmountsOut,
                userData: abi.encode(exitKind, bptIn),
                toInternalBalance: false
            })
        );
    }
}
