import { useSyncExternalStore } from "react";
import { createWalletClient, createPublicClient, custom, defineChain, type EIP1193Provider } from "viem";

export const BOT_CHAIN = defineChain({
  id: 677,
  name: "BOT Chain Mainnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.botchain.ai"] } },
  blockExplorers: { default: { name: "BOTChain Explorer", url: "https://scan.botchain.ai/" } },
});
export const BOT_CHAIN_HEX = "0x2a5";
export const CONTRACT_ADDRESS = "0x4934e47a285EC8AFb1A56BBB247C8091913F3BEC" as const;
export const EXPLORER = "https://scan.botchain.ai";

export const WATTNOW_ABI = [
  { inputs: [], name: "SAVE_FEE", outputs: [{ type: "uint256", name: "" }], stateMutability: "view", type: "function" },
  {
    inputs: [],
    name: "getMyScans",
    outputs: [
      {
        type: "tuple[]",
        name: "",
        components: [
          { name: "user", type: "address" },
          { name: "kWh", type: "uint256" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [{ name: "kWh", type: "uint256" }], name: "saveScan", outputs: [], stateMutability: "payable", type: "function" },
] as const;

type Eth = EIP1193Provider & {
  on?: (e: string, cb: (...a: unknown[]) => void) => void;
};

export function getEthereum(): Eth | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { ethereum?: Eth }).ethereum) ?? null;
}

interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
}
let state: WalletState = { address: null, chainId: null };
const listeners = new Set<() => void>();
let bound = false;
const DISCONNECT_KEY = "wattnow:wallet-disconnected";

function setState(p: Partial<WalletState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

async function bind() {
  if (bound) return;
  const eth = getEthereum();
  if (!eth) return;
  bound = true;
  eth.on?.("accountsChanged", (a) => {
    const list = a as string[];
    setState({ address: (list[0] as `0x${string}`) ?? null });
  });
  eth.on?.("chainChanged", (c) => setState({ chainId: parseInt(c as string, 16) }));
  try {
    const chain = (await eth.request({ method: "eth_chainId" })) as string;
    setState({ chainId: parseInt(chain, 16) });
    if (localStorage.getItem(DISCONNECT_KEY) !== "1") {
      const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
      if (accounts[0]) setState({ address: accounts[0] as `0x${string}` });
    }
  } catch {
    /* ignore */
  }
}

const serverSnap: WalletState = { address: null, chainId: null };
export function useWallet() {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      void bind();
      return () => listeners.delete(l);
    },
    () => state,
    () => serverSnap,
  );
  return { ...s, onBotChain: s.chainId === BOT_CHAIN.id };
}

export async function connectWallet() {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not found. Install MetaMask to connect your wallet.");
  await bind();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  localStorage.removeItem(DISCONNECT_KEY);
  setState({ address: (accounts[0] as `0x${string}`) ?? null });
}

export async function changeWallet() {
  const eth = getEthereum();
  if (!eth) return;
  await eth.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  await connectWallet();
}

export function disconnectWallet() {
  localStorage.setItem(DISCONNECT_KEY, "1");
  const eth = getEthereum();
  eth?.request({ method: "wallet_revokePermissions" as never, params: [{ eth_accounts: {} }] as never }).catch(() => undefined);
  setState({ address: null });
}

export async function switchToBotChain() {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not found.");
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BOT_CHAIN_HEX }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 4902 || code === -32603) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BOT_CHAIN_HEX,
            chainName: "BOT Chain Mainnet",
            nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
            rpcUrls: ["https://rpc.botchain.ai"],
            blockExplorerUrls: [EXPLORER + "/"],
          },
        ],
      });
    } else throw e;
  }
}

function clients() {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not found.");
  return {
    wallet: createWalletClient({ chain: BOT_CHAIN, transport: custom(eth) }),
    pub: createPublicClient({ chain: BOT_CHAIN, transport: custom(eth) }),
  };
}

export async function readSaveFee(): Promise<bigint> {
  try {
    return await clients().pub.readContract({ address: CONTRACT_ADDRESS, abi: WATTNOW_ABI, functionName: "SAVE_FEE" });
  } catch (e) {
    throw new Error(
      "Could not read the SAVE_FEE from the WattNow contract. Please check your wallet network connection (BOT Chain Mainnet, chain ID 677) and try again.",
      { cause: e },
    );
  }
}

export async function saveScanOnChain(kwh: bigint, account: `0x${string}`) {
  const { wallet, pub } = clients();
  const fee = await readSaveFee();
  const hash = await wallet.writeContract({
    account,
    address: CONTRACT_ADDRESS,
    abi: WATTNOW_ABI,
    functionName: "saveScan",
    args: [kwh],
    value: fee,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted on BOT Chain.");
  return hash;
}

export async function getMyScans(account: `0x${string}`) {
  return clients().pub.readContract({
    account,
    address: CONTRACT_ADDRESS,
    abi: WATTNOW_ABI,
    functionName: "getMyScans",
  });
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
export const friendlyError = (e: unknown) => {
  const err = e as { shortMessage?: string; message?: string; code?: number };
  if (err.code === 4001) return "You rejected the request in MetaMask.";
  return err.shortMessage ?? err.message ?? "Something went wrong.";
};
