import { assert } from 'console';
import { ethers } from 'hardhat';
import { BigNumber } from '@ethersproject/bignumber';
import { MaxUint256, One } from '@ethersproject/constants';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import {
  TokenList,
  printGas,
  pickTokenAddresses,
  setupEnvironment,
  txConfirmation,
} from '@balancer-examples/shared-dependencies';
import {
  Vault,
  Vault__factory,
  WeightedPool,
  WeightedPoolFactory,
  WeightedPoolFactory__factory,
  WeightedPool__factory,
} from '@balancer-labs/typechain';

import { WeightedPoolEncoder, toNormalizedWeights } from '@balancer-examples/balancer-js';

// setup environment
const BPTAmount = BigNumber.from(1e18);

let vault: Vault;
let tokens: TokenList;
let trader: SignerWithAddress;

async function main() {
  ({ vault, tokens, trader } = await setupEnvironment());

  const weightedPoolFactory = await deployWeightedPoolFactory(vault, trader);

  // Deploy our new pool
  const name = 'My Pool';
  const symbol = 'POOL';
  const poolTokens = pickTokenAddresses(tokens, 2);
  const normalizedWeights = toNormalizedWeights(poolTokens.map(() => One));
  const swapFeePercentage = BigNumber.from(1e12);
  const delegateOwner = '0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B';
  const deploymentReceipt = await txConfirmation(
    weightedPoolFactory.create(name, symbol, poolTokens, normalizedWeights, swapFeePercentage, delegateOwner)
  );

  const event = deploymentReceipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  const pool = WeightedPool__factory.connect(event.args?.pool, trader);

  // Add initial liquidity to the pool
  await joinPool(pool, true);

  console.log('\n');
}

async function joinPool(pool: WeightedPool, transferTokens: boolean) {
  const poolId = await pool.getPoolId();

  const { tokens } = await Vault__factory.connect(await pool.getVault(), pool.provider).getPoolTokens(poolId);

  const userData = WeightedPoolEncoder.joinTokenInForExactBPTOut(BPTAmount, 0);

  const joinRequest = {
    assets: tokens,
    maxAmountsIn: tokens.map(() => MaxUint256),
    userData,
    fromInternalBalance: !transferTokens,
  };

  const receipt = await txConfirmation(
    vault.connect(trader).joinPool(poolId, trader.address, trader.address, joinRequest)
  );
  console.log(`${printGas(receipt.gasUsed)} gas`);

  const bpt: BigNumber = await pool.balanceOf(trader.address);

  // check token balances
  assert(bpt.eq(BPTAmount), 'Did not actually join pool');
}

async function deployWeightedPoolFactory(vault: Vault, deployer: SignerWithAddress): Promise<WeightedPoolFactory> {
  // TODO: Import factory artifact from monorepo
  const { abi, bytecode } = {};

  const factory = new ethers.ContractFactory(abi, bytecode, deployer);
  const instance = await factory.deploy([vault.address]);
  return WeightedPoolFactory__factory.connect(instance.address, deployer);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
