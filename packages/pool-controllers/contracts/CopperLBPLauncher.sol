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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-vault/contracts/Vault.sol";
import "@balancer-labs/v2-pool-weighted/contracts/smart/LiquidityBootstrappingPoolFactory.sol";
import "@balancer-labs/v2-pool-weighted/contracts/smart/LiquidityBootstrappingPool.sol";
import "@balancer-labs/v2-pool-weighted/contracts/BaseWeightedPool.sol";

import "./ScalingMath.sol";
// This will be in the NPM solidity-utils package, but isn't yet, so included locally for now.
import "./TimelockController.sol";

contract CopperLBPLauncher {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    // These are all two-token pools: a projectToken (being sold), and a reserve currency (here called
    // the fundToken), but since the tokens must be sorted, it is not possible to control the order and
    // always put one or the other first, so the fundToken must be identified externally by index.
    struct PoolData {
        address owner;
        address ownerCandidate; // Proposed new pool owner, prior to claiming
        uint256 fundTokenIndex;
        uint256 fundTokenSeedAmount;
    }

    // Ensure all LBPs are at least this length
    uint256 public constant MINIMUM_LBP_DURATION = 1 days;

    // Time required to change the fee recipient
    uint256 public constant MIN_TIMELOCK_DELAY = 3 days;

    // Store the factory used to create the LBPs
    address public immutable lbpFactoryAddress;

    // Store the fee percentage, as a FixedPoint number. 30 bps = 3e15
    uint256 public immutable exitFeePercentage;

    // Joins and exits are done through calls on the Balancer Vault
    address payable public immutable vault;

    // All proceeds are send to this address (should be a contract). This address can be changed by the manager.
    address private _feeRecipient;

    // The address empowered to call permissioned functions.
    address private _manager;

    // Target of a proposed transfer of ownership. Will be non-zero if there is a transfer pending.
    // This address must call claimOwnership to complete the transfer.
    address private _managerCandidate;

    mapping(address => PoolData) private _poolData;
    // Add a set so that they are iterable
    EnumerableSet.AddressSet private _pools;

    // Will be redeployed on a manager change, so cannot be immutable
    TimelockController private _timelockController;

    constructor(
        address payable balancerVault,
        uint256 feePercentage,
        address feeRecipient,
        address factoryAddress
    ) {
        vault = balancerVault;
        exitFeePercentage = feePercentage;
        _feeRecipient = feeRecipient;
        lbpFactoryAddress = factoryAddress;

        _setManager(msg.sender);
    }

    // Events

    event ExitFeePaid(address indexed pool, IERC20 token, address feeRecipient, uint256 feeAmount);

    event OwnershipTransferred(address indexed previousManager, address indexed newManager);

    event PoolOwnershipTransferred(address indexed pool, address previousOwner, address newOwner);

    event FeeRecipientChanged(address previousRecipient, address newRecipient);

    // Modifiers

    /**
     * @dev Reverts if called by any account other than the manager.
     */
    modifier onlyManager() {
        require(getManager() == msg.sender, "Caller is not manager");
        _;
    }

    /**
     * @dev Reverts if called by any account other than the owner of the pool.
     */
    modifier onlyPoolOwner(address pool) {
        require(_pools.contains(pool), "Invalid pool address");
        require(msg.sender == _poolData[pool].owner, "Caller is not pool owner");
        _;
    }

    /**
     * @dev Getter for the current manager.
     */
    function getManager() public view returns (address) {
        return _manager;
    }

    /**
     * @dev Getter for the tinelock controller.
     */
    function getTimelockController() public view returns (address) {
        return address(_timelockController);
    }

    /**
     * @dev Checks if there is a controlled pool with the given address.
     */
    function isPool(address pool) external view returns (bool) {
        return _pools.contains(pool);
    }

    /**
     * @dev Returns the total number of controlled pools.
     */
    function poolCount() external view returns (uint256) {
        return _pools.length();
    }

    /**
     * @dev Returns the nth pool. This supports UI-friendly pagination.
     */
    function getPoolAt(uint256 index) external view returns (address) {
        require(index < _pools.length(), "Invalid pool index");

        return _pools.unchecked_at(index);
    }

    /**
     * @dev Returns the entire set of controlled pool addresses.
     */
    function getPools() external view returns (address[] memory) {
        uint256 numPools = _pools.length();

        address[] memory pools = new address[](numPools);

        for (uint256 i = 0; i < numPools; i++) {
            pools[i] = _pools.at(i);
        }

        return pools;
    }

    /**
     * @dev Returns a struct with a pool's metadata, given a valid address.
     */
    function getPoolData(address pool) external view returns (PoolData memory) {
        require(_pools.contains(pool), "Invalid pool address");

        return _poolData[pool];
    }

    /**
     * @dev Get this contract's balance of a given pool's BPT. BPTs are always 18 decimals, so no scaling is necessary.
     */
    function getBPTTokenBalance(address pool) external view returns (uint256 bptBalance) {
        require(_pools.contains(pool), "Invalid pool address");

        return IERC20(pool).balanceOf(address(this));
    }

    struct PoolConfig {
        string name;
        string symbol;
        IERC20[] tokens;
        uint256[] amounts;
        uint256[] weights;
        uint256[] endWeights;
        uint256 fundTokenIndex;
        uint256 swapFeePercentage;
        bytes userData;
        uint256 startTime;
        uint256 endTime;
        address owner;
    }

    /**
     * @dev Deploy, fund, and trigger the gradual weight update for a new LBP. The LBP owner will be this contract,
     * and swaps are always disabled on start.
     */
    function createAuction(PoolConfig memory poolConfig) external onlyManager returns (address) {
        require(poolConfig.tokens.length == 2, "Only 2-token LBPs");
        // The factory create will revert (right away) if the weights do not match, but incorrect end weights
        // would not revert until the very end. Check here to make this error less costly.
        require(poolConfig.endWeights.length == 2, "Length mismatch");
        // Also check that the start/end times are valid and above the minimum, before going further
        require(poolConfig.startTime < poolConfig.endTime, "Invalid LBP times");
        require(poolConfig.endTime - poolConfig.startTime >= MINIMUM_LBP_DURATION, "LBP duration too short");

        // 1: Deploy the LBP (The factory emits a PoolCreated event)
        address pool = LiquidityBootstrappingPoolFactory(lbpFactoryAddress).create(
            poolConfig.name,
            poolConfig.symbol,
            poolConfig.tokens,
            poolConfig.weights,
            poolConfig.swapFeePercentage,
            address(this), // set the owner to this controller contract
            false // swaps disabled on start
        );

        // 2: Transfer initial deposit from the owner to this contract, and approve the Vault
        uint256 projectTokenIndex = 0 == poolConfig.fundTokenIndex ? 1 : 0;

        IERC20 fundToken = poolConfig.tokens[poolConfig.fundTokenIndex];
        IERC20 projectToken = poolConfig.tokens[projectTokenIndex];

        uint256 fundTokenAmount = poolConfig.amounts[poolConfig.fundTokenIndex];
        uint256 projectTokenAmount = poolConfig.amounts[projectTokenIndex];

        fundToken.safeTransferFrom(poolConfig.owner, address(this), fundTokenAmount);
        projectToken.safeTransferFrom(poolConfig.owner, address(this), projectTokenAmount);

        fundToken.approve(vault, fundTokenAmount);
        projectToken.approve(vault, projectTokenAmount);

        // Fund the pool from this contract

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(poolConfig.tokens),
            maxAmountsIn: poolConfig.amounts,
            userData: poolConfig.userData,
            fromInternalBalance: false
        });

        Vault(vault).joinPool(
            LiquidityBootstrappingPool(pool).getPoolId(),
            address(this), // sender - source of initial deposit
            address(this), // recipient - destination of BPT
            request
        );
        // Vault emits PoolBalancedChanged

        // 4: Record the pool data in both the mapping and the enumerable set
        _poolData[pool] = PoolData(
            poolConfig.owner,
            address(0), // ownerCandidate
            poolConfig.fundTokenIndex,
            poolConfig.amounts[poolConfig.fundTokenIndex]
        );
        _pools.add(pool);

        // 5: configure weights
        LiquidityBootstrappingPool(pool).updateWeightsGradually(
            poolConfig.startTime,
            poolConfig.endTime,
            poolConfig.endWeights
        );

        return pool;
    }

    /**
     * @dev Allows the pool owner to enable/disable trading on the underlying pool.
     * Trading is initially disabled, so this should be called to begin the sale.
     */
    function setSwapEnabled(address pool, bool swapEnabled) external onlyPoolOwner(pool) {
        LiquidityBootstrappingPool(pool).setSwapEnabled(swapEnabled);
    }

    /**
     * @dev Transfer ownership of the underlying pool. Only the pool owner can exit and claim the proceeds,
     * so for safety, this is a 2-step process. The new owner must call `claimPoolOwnership` to complete
     * the transfer.
     */
    function transferPoolOwnership(address pool, address newOwner) external onlyPoolOwner(pool) {
        _poolData[pool].ownerCandidate = newOwner;
    }

    function claimPoolOwnership(address pool) external {
        PoolData memory data = _poolData[pool];

        // This function must be called by the candidate to complete the transfer
        require(msg.sender == data.ownerCandidate, "Sender not allowed");

        emit PoolOwnershipTransferred(pool, data.owner, data.ownerCandidate);
        _poolData[pool].owner = data.ownerCandidate;
        // Setting the candidate to zero prevents calling this repeatedly and generating multiple redundant events,
        // and also allows checking (perhaps by a UI) whether there is a pending transfer.
        _poolData[pool].ownerCandidate = address(0);
    }

    /**
     * Exit a pool and recover the proceeds (minus fees). This will burn some or all of the BPT held by this contract.
     * If maxBPTTokenIn is 0, this will fully exit: all BPT will be burned.
     * If maxBPTTokenIn is non-zero, this will partially exit with this amount.
     */
    function exitPool(
        address pool,
        uint256[] calldata minAmountsOut,
        uint256 maxBPTAmountIn
    ) external onlyPoolOwner(pool) {
        // 1. Get pool data
        bytes32 poolId = LiquidityBootstrappingPool(pool).getPoolId();
        (IERC20[] memory poolTokens, , ) = Vault(vault).getPoolTokens(poolId);
        require(poolTokens.length == minAmountsOut.length, "invalid input length");
        PoolData memory poolData = _poolData[pool];

        // 2. Calculate the exact BPT amount to burn
        uint256 bptToBurn = _calculateBptAmountIn(pool, maxBPTAmountIn);

        // Proportional exit
        bytes memory userData = abi.encode(BaseWeightedPool.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptToBurn);
        IVault.ExitPoolRequest memory exitRequest = IVault.ExitPoolRequest({
            assets: _asIAsset(poolTokens),
            minAmountsOut: minAmountsOut,
            userData: userData,
            toInternalBalance: false
        });

        // 3. Exit pool and keep tokens in this contract
        Vault(vault).exitPool(poolId, address(this), payable(address(this)), exitRequest);

        // 4. Calculate and transfer fee to recipient
        _payExitFee(pool, poolTokens, poolData);

        // 5. Transfer remaining proceeds to pool owner
        _transferProceeds(poolTokens, poolData);
    }

    function _calculateBptAmountIn(address pool, uint256 maxBPTAmountIn) private view returns (uint256 bptToBurn) {
        uint256 bptBalance = IERC20(pool).balanceOf(address(this));
        require(bptBalance > 0, "BPT balance is zero");

        bptToBurn = 0 == maxBPTAmountIn ? bptBalance : maxBPTAmountIn;

        // Checked above that the balance is non-zero; so if this check fails, they passed in too much
        require(bptToBurn <= bptBalance, "Insufficient BPT balance");
    }

    function _payExitFee(
        address pool,
        IERC20[] memory poolTokens,
        PoolData memory poolData
    ) private {
        IERC20 fundToken = poolTokens[poolData.fundTokenIndex];
        uint256 scalingFactor = ScalingMath.computeScalingFactor(fundToken);

        uint256 fundTokenBalance = ScalingMath.upscale(IERC20(fundToken).balanceOf(address(this)), scalingFactor);
        uint256 seedAmount = ScalingMath.upscale(poolData.fundTokenSeedAmount, scalingFactor);

        // Only charge fees if the LBP was profitable, and the fundToken balance increased
        if (fundTokenBalance > seedAmount) {
            // Calculate the fee with 18-decimal precision
            uint256 scaledFeeAmount = (fundTokenBalance - seedAmount).mulDown(exitFeePercentage);
            // Scale back to native decimals
            uint256 feeAmount = ScalingMath.downscale(scaledFeeAmount, scalingFactor);

            fundToken.safeTransfer(_feeRecipient, feeAmount);
            emit ExitFeePaid(pool, fundToken, _feeRecipient, feeAmount);
        }
    }

    function _transferProceeds(IERC20[] memory poolTokens, PoolData memory poolData) private {
        IERC20 fundToken = poolTokens[poolData.fundTokenIndex];
        uint256 fundTokenBalance = IERC20(fundToken).balanceOf(address(this));
        fundToken.safeTransfer(msg.sender, fundTokenBalance);

        uint256 projectTokenIndex = 0 == poolData.fundTokenIndex ? 1 : 0;
        IERC20 projectToken = poolTokens[projectTokenIndex];

        uint256 projectTokenBalance = IERC20(projectToken).balanceOf(address(this));
        projectToken.safeTransfer(msg.sender, projectTokenBalance);
    }

    /**
     * @dev Change the manager of this contract. Though a faulty transfer is much less dangerous here
     * than with the underlying pool (where funds would be lost), it follows the same 2-step process.
     */
    function transferOwnership(address newManager) external onlyManager {
        _managerCandidate = newManager;
    }

    function claimOwnership() external {
        address candidate = _managerCandidate;

        require(candidate == msg.sender, "Sender not allowed");

        emit OwnershipTransferred(_manager, candidate);

        // Redeploy timelock - any pending operations from the previous manager will revert, and should be canceled.
        _setManager(candidate);

        // Setting the candidate to zero prevents calling this repeatedly and generating multiple redundant events,
        // and also allows checking (perhaps by a UI) whether there is a pending transfer.
        _managerCandidate = address(0);
    }

    /**
     * @dev Getter for fee recipient contract.
     */
    function getFeeRecipient() external view returns (address) {
        return _feeRecipient;
    }

    /**
     * @dev Change the address that will receive the LBP fees, typically a revenue sharing contract.
     * This operation is on a timelock. The manager must schedule the changeFeeRecipient call, and execute
     * it after the delay.
     *
     * Changing the manager redeploys a new timelock (owned by the successor manager), so any pending operations
     * from the old manager will revert.
     */
    function changeFeeRecipient(address newRecipient) external {
        require(msg.sender == getTimelockController(), "Must use timelock");

        address previousFeeReciepient = _feeRecipient;
        _feeRecipient = newRecipient;

        emit FeeRecipientChanged(previousFeeReciepient, newRecipient);
    }

    function _setManager(address owner) private {
        _manager = owner;

        // After setting the manager, (re)deploy the timelock

        address[] memory proposers = new address[](1);
        address[] memory executors = new address[](1);
        proposers[0] = owner;
        executors[0] = owner;

        _timelockController = new TimelockController(MIN_TIMELOCK_DELAY, proposers, executors);
    }

    function _asIAsset(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            assets := tokens
        }
    }
}
