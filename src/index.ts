import { ethers } from "ethers";
import { aDAO, ERC1967Proxy, aDAOFactory, EntryPoint } from "./contracts";
import { ZERO, ZERO_BYTES, DUMMY_SIGNATURE } from "./constants";

import { BuildUserOp, Call, DummyUserOp, FindUserOpStatus, FindUserOpStatusResult, GetUserOpHash, aDAOProxyWithNonce, UserOpStatus } from "./types";

import config from "./config.json";

const getChainConfig = (chainId: number) => {
  const SUPPORTED_CHAINS = Object.keys(config);
  if (!SUPPORTED_CHAINS.includes(chainId.toString())) {
      throw new Error(`Chain ${chainId} not supported`);
  }
  Date.now();
  return config[chainId.toString() as keyof typeof config];
};

const getExecuteCalldata = (calls: Call[]) => {
  if (calls.length === 0) {
      throw new Error('No calls provided');
  }

  if (calls.length === 1) {
      return new ethers.Interface(aDAO.abi).encodeFunctionData(
          'execute(uint256,address,uint256,bytes)',
          [
              calls[0].operation || 0,
              calls[0].target || ethers.ZeroAddress,
              calls[0].value || ZERO,
              calls[0].data || ZERO_BYTES
          ]
      );
  }

  return new ethers.Interface(aDAO.abi).encodeFunctionData(
      'execute(uint256[],address[],uint256[],bytes[])',
      [
          calls.map((call) => call.operation || 0),
          calls.map((call) => call.target || ethers.ZeroAddress),
          calls.map((call) => call.value || ZERO),
          calls.map((call) => call.data || ZERO_BYTES)
      ]
  );
};

const userOpRevertedErrorDecode = (revertReason: string) => {
  const iface = new ethers.Interface([
    'function Error(string)',
  ]);
  const [error] = iface.decodeFunctionData('Error(string)', revertReason);
  return error;
};

export default {
    getWalletProxyAddress : ({
        chainId,
        owners,
        threshold,
        saltNonce,
    }: aDAOProxyWithNonce): string => {
        const { aDAOFactory: aDAOFactoryAddress, aDAO: aDAOAddress } = getChainConfig(chainId);
        const adaoInterface = new ethers.Interface(aDAO.abi);
        const initializeCallData = adaoInterface.encodeFunctionData('initialize(address[],uint256)', [owners, threshold]);
        const abiCoder = new ethers.AbiCoder();
        const encodedWithImp = abiCoder.encode(
            ['address', 'bytes'],
            [aDAOAddress, initializeCallData],
        );
        const deploymentData = ethers.solidityPackedKeccak256(['bytes', 'bytes'], [ERC1967Proxy.bytecode.object, encodedWithImp]);
        const salt = ethers.solidityPacked(['uint256'], [saltNonce]);
        return ethers.getCreate2Address(aDAOFactoryAddress, salt, deploymentData);
    },
    getWalletProxyInitCode : ({
        chainId,
        owners,
        threshold,
        saltNonce,
    }: aDAOProxyWithNonce): string => {
        const { aDAOFactory: aDAOFactoryAddress } = getChainConfig(chainId);
        const adaoFactoryInterface = new ethers.Interface(aDAOFactory.abi);
        const salt = ethers.solidityPacked(['uint256'], [saltNonce]);
        const initializeData = adaoFactoryInterface.encodeFunctionData('createAccount', [owners, threshold, salt]);
        return ethers.solidityPacked(
            ['address', 'bytes'],
            [aDAOFactoryAddress, initializeData],
        );
    },
    buildDummyUserOp : ({
        sender,
        calls,
        nonce,
        initCode,
    }: BuildUserOp): DummyUserOp => ({
        sender,
        nonce,
        callData: getExecuteCalldata(calls),
        initCode: initCode || ZERO_BYTES,
        paymasterAndData: "0x",
        signature: DUMMY_SIGNATURE,
    }),
    getUserOpHash : ({
        chainId,
        userOp,
    }: GetUserOpHash) : string => {
        const { EntryPoint: EntryPointAddress } = getChainConfig(chainId);
        const abiCoder = new ethers.AbiCoder();
        const packedHash = ethers.keccak256(abiCoder.encode(
            [
                'address',
                'uint256',
                'bytes32',
                'bytes32',
                'uint256',
                'uint256',
                'uint256',
                'uint256',
                'uint256',
                'bytes32',
            ],
            [
                userOp.sender,
                userOp.nonce,
                ethers.keccak256(userOp.initCode),
                ethers.keccak256(userOp.callData),
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                ethers.keccak256(userOp.paymasterAndData),
            ],
        ));
        const enc = abiCoder.encode(
            ['bytes32', 'address', 'uint256'],
            [packedHash, EntryPointAddress, chainId],
        );
        return ethers.keccak256(enc);
    },
    findUserOpStatus : ({
        chainId,
        receipt,
        userOpHash,
    }: FindUserOpStatus) : FindUserOpStatusResult => {
        const { EntryPoint: EntryPointAddress } = getChainConfig(chainId);
        let error;
        let status = UserOpStatus.UNKNOWN;
        const entryPointLogs = receipt.logs.filter((item) => item.address.toLowerCase() === EntryPointAddress.toLowerCase());
        const entryPointInterface = new ethers.Interface(EntryPoint.abi);
        entryPointLogs.forEach((item: ethers.Log) => {
            const { topics, data } = item;
            const parsedLog = entryPointInterface.parseLog({
                topics: topics.map((topic) => topic),
                data,
            });
            if (!parsedLog) return;

            if (parsedLog.signature === 'UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)') {
              if (parsedLog.args[0] !== userOpHash) return;
              const success = parsedLog.args[4];
              status = success ? UserOpStatus.CONFIRMED : UserOpStatus.REVERTED;
            }

            if (parsedLog.signature === 'UserOperationRevertReason(bytes32,address,uint256,bytes)') {
              if (parsedLog.args[0] !== userOpHash) return;
              const revertReason = parsedLog.args[3];
              status = UserOpStatus.REVERTED;
              error = revertReason === '0x' ? 'out-of-gas' : userOpRevertedErrorDecode(revertReason);
            }
        });
        return {
            status,
            error,
        };
    },
}
