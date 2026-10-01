import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { ExternalLink, Link2, Loader2, LogOut, RefreshCw, Wallet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  EXPLORER,
  changeWallet,
  connectWallet,
  disconnectWallet,
  friendlyError,
  getMyScans,
  readSaveFee,
  saveScanOnChain,
  shortAddr,
  switchToBotChain,
  useWallet,
} from "@/lib/web3";

export function WalletButton() {
  const { address, onBotChain } = useWallet();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!address) {
    return (
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await connectWallet();
          } catch (e) {
            toast.error(friendlyError(e));
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 font-medium text-foreground transition-colors hover:bg-accent"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
        <span className="hidden sm:inline">Connect Wallet</span>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 font-mono text-xs ${
          onBotChain ? "border-primary/50 text-primary" : "border-warning/60 text-warning"
        }`}
      >
        {onBotChain ? <Wallet className="size-4" /> : <AlertTriangle className="size-4" />}
        {shortAddr(address)}
      </button>
      {open && (
        <div className="panel absolute right-0 top-full z-50 mt-2 w-60 p-2 text-sm">
          {!onBotChain && (
            <button
              onClick={() => switchToBotChain().catch((e) => toast.error(friendlyError(e)))}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-warning hover:bg-accent"
            >
              <Link2 className="size-4" /> Switch to BOT Chain
            </button>
          )}
          <button
            onClick={() => {
              setOpen(false);
              changeWallet().catch((e) => toast.error(friendlyError(e)));
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-accent"
          >
            <RefreshCw className="size-4" /> Change wallet
          </button>
          <button
            onClick={() => {
              setOpen(false);
              disconnectWallet();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-accent hover:text-destructive"
          >
            <LogOut className="size-4" /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function useFee(enabled: boolean) {
  const [fee, setFee] = useState<bigint | null>(null);
  useEffect(() => {
    if (!enabled) return;
    readSaveFee()
      .then(setFee)
      .catch((e) => {
        setFee(null);
        // Surface a helpful hint instead of an unhandled "0x" error popup.
        toast.error(friendlyError(e));
      });
  }, [enabled]);
  return fee;
}

/** Monthly kWh is stored on-chain as a whole number (contract uses uint256). */
export function SaveOnChain({ monthlyKwh }: { monthlyKwh: number }) {
  const { address, onBotChain } = useWallet();
  const fee = useFee(!!address && onBotChain);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const kwh = Math.max(0, Math.round(monthlyKwh));

  async function save() {
    setBusy(true);
    try {
      if (!address) {
        await connectWallet();
        return;
      }
      if (!onBotChain) {
        await switchToBotChain();
        return;
      }
      const hash = await saveScanOnChain(BigInt(kwh), address);
      setTx(hash);
      toast.success("Scan saved on BOT Chain.");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const label = !address
    ? "Connect Wallet to Save On-Chain"
    : !onBotChain
      ? "Switch to BOT Chain"
      : "Save Scan On-Chain";

  return (
    <section className="no-print panel p-5">
      <p className="font-mono text-xs uppercase tracking-widest text-primary">BOT Chain</p>
      <h2 className="mt-1 text-lg font-semibold">Save this scan on-chain</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Records <strong className="text-foreground">{kwh} kWh/month</strong> (estimated), your wallet address and
        the time to the WattNow contract.
        {address && onBotChain && fee !== null && (
          <> Fee: <strong className="text-foreground">{formatEther(fee)} BOT</strong> + network gas — MetaMask shows the full amount before you confirm.</>
        )}
      </p>
      <button
        onClick={save}
        disabled={busy || !!tx}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : tx ? <CheckCircle2 className="size-4" /> : <Link2 className="size-4" />}
        {busy ? "Waiting for confirmation…" : tx ? "Saved On-Chain" : label}
      </button>
      {tx && (
        <div className="mt-4 rounded-xl border border-primary/40 p-3 text-xs">
          <p className="text-muted-foreground">Transaction hash</p>
          <p className="mt-1 break-all font-mono text-foreground">{tx}</p>
          <a href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-primary underline">
            View on BOTChain Explorer <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    </section>
  );
}

export function OnChainHistory() {
  const { address, onBotChain } = useWallet();
  const [scans, setScans] = useState<readonly { kWh: bigint; timestamp: bigint }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setScans(null);
    setErr(null);
    if (!address || !onBotChain) return;
    getMyScans(address).then(setScans).catch((e) => setErr(friendlyError(e)));
  }, [address, onBotChain]);

  return (
    <section className="panel mt-8 p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-primary">Blockchain history</p>
      <h2 className="mt-2 text-xl font-bold">My on-chain scans</h2>
      {!address ? (
        <p className="mt-3 text-sm text-muted-foreground">Connect your wallet to see scans saved on BOT Chain.</p>
      ) : !onBotChain ? (
        <button onClick={() => switchToBotChain().catch((e) => toast.error(friendlyError(e)))} className="mt-3 text-sm text-warning underline">
          Switch to BOT Chain to load your scans
        </button>
      ) : err ? (
        <p className="mt-3 text-sm text-destructive">{err}</p>
      ) : !scans ? (
        <Loader2 className="mt-3 size-4 animate-spin text-muted-foreground" />
      ) : scans.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No scans saved on-chain yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {[...scans].reverse().map((s, i) => (
            <li key={i} className="flex justify-between py-2 text-sm">
              <span className="text-muted-foreground">
                {new Date(Number(s.timestamp) * 1000).toLocaleString("en-GB")}
              </span>
              <span className="font-mono text-watt">{s.kWh.toString()} kWh/month</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
