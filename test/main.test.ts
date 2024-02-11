import { ethers as Ethers } from "ethers";
import { expect } from "chai";
import { ethers } from "hardhat";

import adaoCoreSDK from "../src";
import { Call, DummyUserOp, UserOp } from "../src/types";

import config from "../src/config.json";

import { EntryPoint, OwnersConfig, aDAOFactory } from "../src/contracts";

const getChainConfig = (chainId: number): {
  aDAO: string;
  aDAOFactory: string;
  EntryPoint: string;
  OwnersConfig: string;
} => {
  const SUPPORTED_CHAINS = Object.keys(config);
  if (!SUPPORTED_CHAINS.includes(chainId.toString())) {
      throw new Error(`Chain ${chainId} not supported`);
  }
  return config[chainId.toString() as keyof typeof config] as {
    aDAO: string;
    aDAOFactory: string;
    EntryPoint: string;
    OwnersConfig: string;
  };
};

async function getWalletProxyAddress (
  chainId: number,
  owners: string[],
  threshold: number,
  saltNonce: number,
) {
  const { aDAOFactory: aDAOFactoryAddress } = getChainConfig(chainId)
  const factoryContract = new ethers.Contract(
    aDAOFactoryAddress,
    aDAOFactory.abi,
    new ethers.JsonRpcProvider('http://localhost:8545'),
  );
  return factoryContract.getFunction('getAddress(address[],uint256,uint256)')(owners, threshold, saltNonce);
}

async function estimateUserOperationGas (
  dummyUserOp: DummyUserOp,
  provider: Ethers.Provider,
  gasPriceMultiplier = 100n,
  gasLimitMultiplier = 110n,
) {
  // const feeData = await provider.getFeeData();
  // if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
  //   throw new Error('No fee data');
  // }
  const result = {
    // ...dummyUserOp,
    callGasLimit: 8000000n,
    verificationGasLimit: 10000000n,
    preVerificationGas: 10000000n,
    maxFeePerGas: 10000000000n,
    maxPriorityFeePerGas: 20000000000n,
  } as UserOp;
  return result;
}

async function sendUserOperation (
  chainId: number,
  userOp: UserOp,
  bundler: Ethers.Signer,
  beneficiary: string,
  wait = 1,
) {
  const { EntryPoint: EntrypointAddress } = getChainConfig(chainId)
  const entrypointInterface = new ethers.Interface(EntryPoint.abi);
  const txRequest = {
    to: EntrypointAddress,
    data: entrypointInterface.encodeFunctionData(
      'handleOps',
      [[userOp], beneficiary],
    ),
  }

  // console.log('txRequest', txRequest);

  const result = {
    tx: await bundler.sendTransaction(txRequest),
  } as {
    tx: Ethers.TransactionResponse;
    recipient: Ethers.TransactionReceipt | null;
  }

  // console.log('result', result);

  if (wait) {
    result.recipient = await result.tx.wait(wait);
  }
  return result;
}

async function depositEntrypoint (
  chainId: number,
  from: Ethers.Signer,
  to: string,
  amount: bigint,
  wait = 1,
) {
  const { EntryPoint: EntrypointAddress } = getChainConfig(chainId)
  const entrypointContract = new ethers.Contract(
    EntrypointAddress,
    EntryPoint.abi,
    from,
  );
  const txRequest = {
    to: EntrypointAddress,
    value: amount,
    data: entrypointContract.interface.encodeFunctionData(
      'depositTo(address)',
      [to],
    ),
  }
  const preDeposited = await entrypointContract.balanceOf(to);
  const result = {
    tx: await from.sendTransaction(txRequest),
  } as {
    tx: Ethers.TransactionResponse;
    recipient: Ethers.TransactionReceipt | null;
  }
  if (wait) {
    result.recipient = await result.tx.wait(wait);
  }
  const postDeposited = await entrypointContract.balanceOf(to);
  expect(amount).equal(postDeposited - preDeposited);
  return result;
}

async function processUserOp (
  adminSigner: Ethers.Signer,
  provider: Ethers.Provider,
  chainId: number,
  owners: Ethers.Signer[],
  sender: string,
  calls: Call[],
  nonce: bigint,
  initCode: string,
) {

  const admin = await adminSigner.getAddress();

  // console.log('admin', admin);

  // build dummy user op
  const dummyUserOp = adaoCoreSDK.buildDummyUserOp({
    sender,
    calls,
    nonce,
    initCode,
  });

  // console.log('dummyUserOp', dummyUserOp);

  // estimate gas values
  const gasResults = await estimateUserOperationGas(dummyUserOp, provider);

  // console.log('gasResults', gasResults);

  const userOpWithGas = {
    ...dummyUserOp,
    ...gasResults,
  };

  // console.log('userOpWithGas', userOpWithGas);

  // sign user op
  const userOpHash = adaoCoreSDK.getUserOpHash({
    chainId,
    userOp: userOpWithGas,
  });

  // console.log('userOpHash', userOpHash);

  const signatures = await Promise.all(owners.map(async (owner) => owner.signMessage(ethers.getBytes(userOpHash))));

  // console.log('signatures', signatures);

  const signature = signatures.reduce ((acc, sig) => ethers.solidityPacked(["bytes", "bytes"], [acc, sig]) , "0x");

  // console.log('signature', signature);

  const userOpWithSignature = {
    ...userOpWithGas,
    signature,
  };

  // console.log('userOpWithSignature', userOpWithSignature);

  // predeposit eth if paymaster is not set
  // const gasNeeded = getUserOpMaxGas(userOpWithSignature);

  // // console.log('gasNeeded', gasNeeded);

  // await depositEntrypoint(chainId, adminSigner, userOpWithSignature.sender, gasNeeded);

  // // console.log('depositEntrypoint');

  // send user op
  await sendUserOperation(chainId, userOpWithSignature, adminSigner, admin);

  // console.log('sendUserOperation');
}

function getUserOpMaxGas (userOp: UserOp) {
  return (userOp.maxPriorityFeePerGas + userOp.maxFeePerGas) * (userOp.callGasLimit + userOp.verificationGasLimit + userOp.preVerificationGas);
}

describe('Main', () => {
  let chainId: number;
  let ownersSigners: Ethers.Signer[];
  let owners : string[];
  let extraOwnerSigner : Ethers.Signer;
  let extraOwner: string;

  let provider : Ethers.Provider;

  before(async () => {
    provider = ethers.provider;
    chainId = parseInt((await provider.getNetwork()).chainId.toString());

    const [owner1Signer, owner2Signer, owner3Signer, _extraOwnerSigner] = await ethers.getSigners();
    const [owner1, owner2, owner3, _extraOwner] = await Promise.all([
      owner1Signer.getAddress(),
      owner2Signer.getAddress(),
      owner3Signer.getAddress(),
      _extraOwnerSigner.getAddress(),
    ]);
    ownersSigners = [owner1Signer, owner2Signer, owner3Signer];
    owners = [owner1, owner2, owner3];
    extraOwnerSigner = _extraOwnerSigner;
    extraOwner = _extraOwner;
  });

  it('get address', async () => {
    const adaoAddress = adaoCoreSDK.getWalletProxyAddress({
      chainId,
      owners,
      threshold: 2,
      saltNonce: 0,
    })
    const expaDAOProxyAddress = await getWalletProxyAddress(chainId, owners, 2, 0);
    expect(adaoAddress).equal(expaDAOProxyAddress);
  });

  it('operate', async () => {
    const sender = adaoCoreSDK.getWalletProxyAddress({
      chainId,
      owners,
      threshold: 3,
      saltNonce: 0,
    });

    const { OwnersConfig: OwnersConfigAddress } = getChainConfig(chainId)
    const ownersConfigInterface = new ethers.Interface(OwnersConfig.abi);
    const calls = [
      {
        operation: 4,
        target: OwnersConfigAddress,
        data: ownersConfigInterface.encodeFunctionData('addOwnerWithThreshold(address,uint256)', [extraOwner, 4]),
        value: 0n,
      },
      {
        operation: 4,
        target: OwnersConfigAddress,
        data: ownersConfigInterface.encodeFunctionData('addOwnerWithThreshold(address,uint256)', [ethers.hexlify(ethers.randomBytes(20)), 5]),
        value: 0n,
      }
    ] as Call[];

    const initCode = adaoCoreSDK.getWalletProxyInitCode({
      chainId,
      owners,
      threshold: 3,
      saltNonce: 0,
    });

    await processUserOp(ownersSigners[0], provider, chainId, ownersSigners, sender, calls, 0n, initCode);
  });
});
