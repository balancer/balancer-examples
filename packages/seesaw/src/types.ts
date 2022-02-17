import { BigNumber } from '@ethersproject/bignumber';
import { Decimal } from 'decimal.js';

export type NoNullableField<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

export enum SwapTypes {
  SwapExactIn,
  SwapExactOut,
}

export enum PoolTypes {
  Weighted,
  Stable,
  Element,
  MetaStable,
  Linear,
}

export enum SwapPairType {
  Direct,
  HopIn,
  HopOut,
}

export interface SwapOptions {
  gasPrice: BigNumber;
  swapGas: BigNumber;
  timestamp: number;
  maxPools: number;
  poolTypeFilter: PoolFilter;
  forceRefresh: boolean;
}

export type PoolPairBase = {
  id: string;
  address: string;
  poolType: PoolTypes;
  swapFee: Decimal;
  tokenIn: string;
  tokenOut: string;
  decimalsIn: number;
  decimalsOut: number;
  balanceIn: Decimal;
  balanceOut: Decimal;
};

export interface Swap {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  swapAmount?: string;
  limitReturnAmount?: string;
  maxPrice?: string;
  tokenInDecimals: number;
  tokenOutDecimals: number;
}

export interface SubgraphPoolBase {
  id: string;
  address: string;
  poolType: string;
  swapFee: string;
  swapEnabled: boolean;
  totalShares: string;
  tokens: SubgraphToken[];
  tokensList: string[];

  // Weighted & Element field
  totalWeight?: string;

  // Stable specific fields
  amp?: string;

  // Element specific fields
  expiryTime?: number;
  unitSeconds?: number;
  principalToken?: string;
  baseToken?: string;

  // Linear specific fields
  mainIndex?: number;
  wrappedIndex?: number;
  lowerTarget?: string;
  upperTarget?: string;
}

export type SubgraphToken = {
  address: string;
  balance: string;
  decimals: number;
  priceRate: string;
  // WeightedPool field
  weight: string | null;
};

export interface SwapV2 {
  poolId: string;
  assetInIndex: number;
  assetOutIndex: number;
  amount: string;
  userData: string;
}

export interface SwapInfo {
  tokenAddresses: string[];
  swaps: SwapV2[];
  swapAmount: BigNumber;
  swapAmountForSwaps?: BigNumber; // Used with stETH/wstETH
  returnAmount: BigNumber;
  returnAmountFromSwaps?: BigNumber; // Used with stETH/wstETH
  returnAmountConsideringFees: BigNumber;
  tokenIn: string;
  tokenOut: string;
  marketSp: string;
}

export interface PoolDictionary {
  [poolId: string]: PoolBase;
}

export interface PoolPairDictionary {
  [tokenInOut: string]: PoolPairBase;
}

export interface NewPath {
  id: string; // pool address if direct path, contactenation of pool addresses if multihop
  swaps: Swap[];
  poolPairData: PoolPairBase[];
  limitAmount: BigNumber;
  pools: PoolBase[];
  filterEffectivePrice?: BigNumber; // TODO: This is just used for filtering, maybe there is a better way to filter?
}

export enum PoolFilter {
  All = 'All',
  Weighted = 'Weighted',
  Stable = 'Stable',
  MetaStable = 'MetaStable',
  LBP = 'LiquidityBootstrapping',
  Investment = 'Investment',
  Element = 'Element',
  AaveLinear = 'AaveLinear',
  StablePhantom = 'StablePhantom',
}

export interface PoolBase {
  poolType: PoolTypes;
  swapPairType: SwapPairType;
  id: string;
  address: string;
  tokensList: string[];
  mainIndex?: number;
  setTypeForSwap: (type: SwapPairType) => void;
  getLimitAmountSwap: (poolPairData: PoolPairBase, swapType: SwapTypes) => Decimal;
  _spotPriceAfterSwapExactTokenInForTokenOut: (poolPairData: PoolPairBase, amount: Decimal) => Decimal;
  _spotPriceAfterSwapTokenInForExactTokenOut: (poolPairData: PoolPairBase, amount: Decimal) => Decimal;
  _derivativeSpotPriceAfterSwapExactTokenInForTokenOut: (
    poolPairData: PoolPairBase,
    amount: Decimal 
  ) => Decimal;
  _derivativeSpotPriceAfterSwapTokenInForExactTokenOut: (
    poolPairData: PoolPairBase,
    amount: Decimal
  ) => Decimal;
}

export interface WeightedPool extends PoolBase {
  totalWeight: string;
}

export interface PoolState {
  id: string;
  address: string;
  tokens: string[];
  swapFee: BigNumber;
  weights: BigNumber[];
  balances: BigNumber[];
}
