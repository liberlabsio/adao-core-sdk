import { ethers } from "ethers";

export enum OperationType {
    CALL = 0,
    CREATE = 1,
    CREATE2 = 2,
    STATICCALL = 3,
    DELEGATECALL = 4,
}

export interface Call {
    target?: string;
    operation?: OperationType;
    data?: string;
    value?: bigint;
}

export interface BuildUserOp {
    sender: string;
    calls: Call[];
    nonce: bigint;
    initCode?: string;
}

export interface GetUserOpHash {
    chainId: number
    userOp: UserOp;
}

export interface DummyUserOp {
    sender: string;
    nonce: bigint;
    callData: string;
    paymasterAndData: string;
    signature: string;
    initCode: string;
}

export interface UserOp extends DummyUserOp {
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
}

export enum UserOpStatus {
    UNKNOWN = "UNKNOWN",
    CONFIRMED = "CONFIRMED",
    REVERTED = "REVERTED",
}

export interface FindUserOpStatus {
    chainId: number
    receipt: ethers.TransactionReceipt;
    userOpHash: string;
}

export type FindUserOpStatusResult = {
    status: UserOpStatus;
    error?: string;
}