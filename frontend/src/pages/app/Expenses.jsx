import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Download, Paperclip, Pencil, Plus, Receipt, ScanLine, Search, Trash2 } from "lucide-react";
import { api, download, openFile } from "@/lib/api";
import { date, money, todayISO } from "@/lib/format";
import { Badge, Button, Empty, IconBtn, Input, PageHeader, PageLoader, Segmented, Select, Sheet, Table } from "@/components/ui";
import { ExpenseForm } from "@/components/ExpenseForm";

const blank = () => ({ date: todayISO(), vendor_name: "", vendor_afm: "", category: "materials", description: "", net: "", vat: "", total: "",
  payment_status: "paid", payment_method: "card", document_number: "", mark: "" });

export default function Expenses() {
  const [params] = useSearchParams();
  const [list, setList] = useState(null);
  const [cats, setCats] = useState([]);
  const [filter, setFilter] = useState(params.get("filter") || "all");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setList(await api.get("/expenses")), []);
  useEffect(() => { load().catch(() => setList([])); api.get("/expenses/categories").then(setCats).catch(() => {}); }, [load]);
  const label = (k) => cats.find((c) => c.key === k)?.label || k;
  const month = todayISO().slice(0, 7);

  const shown = useMemo(() => (list || []).filter((x) =>
    ({ all: true, unpaid: x.payment_status === "unpaid", month: x.date?.startsWith(month) }[filter])
    && (!cat || x.category === cat)
    && (!q || `${x.vendor_name} ${x.description} ${x.number}`.toLowerCase().includes(q.toLowerCase()))), [list, filter, cat, q, month]);
  const sum = shown.reduce((s, x) => ({ net: s.net + (x.net || 0), vat: s.vat + (x.vat || 0), total: s.total + (x.total || 0) }), { net: 0, vat: 0, total: 0 });

  const save = async () => {
    setBusy(true);
    const body = { ...editing, net: parseFloat(editing.net) || 0, vat: parseFloat(editing.vat) || 0, total: editing.total === "" ? null : parseFloat(editing.total) };
    try {
      if (editing.id) await api.put(`/expenses/${editing.id}`, body); else await api.post("/expenses", body);
      toast.success("Expense saved"); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const markPaid = async (x) => { try { await api.put(`/expenses/${x.id}`, { ...x, payment_status: "paid" }); load(); } catch (e) { toast.error(e.message); } };
  const del = async (x) => { if (window.confirm(`Delete ${x.number}?`)) { await api.del(`/expenses/${x.id}`).catch((e) => toast.error(e.message)); load(); } };
  const exportCsv = () => {
    const start = filter === "month" ? `${month}-01` : "2000-01-01";
    download(`/reports/export.csv?kind=expenses&start=${start}&end=${todayISO()}`, `expenses-${todayISO()}.csv`).catch((e) => toast.error(e.message));
  };

  if (!list) return <PageLoader />;
  return (
    <div className="animate-in">
      <PageHeader title="Expenses" subtitle="Everything you spend, categorised and ready for your accountant."
        actions={<>
          <Button variant="secondary" onClick={exportCsv}><Download className="h-4 w-4" />Export</Button>
          <Button variant="secondary" onClick={() => setEditing(blank())} data-testid="new-expense"><Plus className="h-4 w-4" />Add manually</Button>
          <Link to="/app/scan" className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand text-white text-sm font-semibold hover:brightness-110"><ScanLine className="h-4 w-4" />Scan</Link>
        </>} />

      {list.length === 0 ? (
        <Empty icon={Receipt} title="No expenses yet" text="Scan a receipt and AI will fill in the vendor, VAT, total and category for you."
          action={<Link to="/app/scan" className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand text-white text-sm font-semibold"><ScanLine className="h-4 w-4" />Scan your first receipt</Link>} />
      ) : (
        <>
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between mb-4">
            <Segmented value={filter} onChange={setFilter} options={[["all", "All"], ["month", "This month"], ["unpaid", "To pay"]]} />
            <div className="flex gap-2">
              <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-48"><option value="">All categories</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select>
              <div className="relative w-full sm:w-56"><Search className="h-4 w-4 absolute left-3 top-3 text-muted" /><Input className="pl-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            </div>
          </div>
          <Table head={["Date", "Vendor", "Category", { label: "Net", className: "text-right hidden md:table-cell" }, { label: "VAT", className: "text-right hidden md:table-cell" }, { label: "Total", className: "text-right" }, "", ""]}>
            {shown.map((x) => (
              <tr key={x.id} className="hover:bg-surface-2/50" data-testid={`expense-row-${x.id}`}>
                <td className="td whitespace-nowrap text-muted">{date(x.date)}</td>
                <td className="td"><p className="font-medium">{x.vendor_name}</p><p className="text-[11px] text-muted truncate max-w-[240px]">{x.description || x.number}</p></td>
                <td className="td"><Badge>{label(x.category)}</Badge></td>
                <td className="td text-right num hidden md:table-cell">{money(x.net, x.currency)}</td>
                <td className="td text-right num text-muted hidden md:table-cell">{money(x.vat, x.currency)}</td>
                <td className="td text-right num font-semibold">{money(x.total, x.currency)}</td>
                <td className="td">{x.payment_status === "unpaid" ? <button onClick={() => markPaid(x)} title="Mark as paid"><Badge tone="warn" className="cursor-pointer hover:ring-2 hover:ring-warn/20">To pay</Badge></button> : <CheckCircle2 className="h-4 w-4 text-success" aria-label="Paid" />}</td>
                <td className="td">
                  <div className="flex justify-end -mr-2">
                    {x.file && <IconBtn icon={Paperclip} label="View receipt" onClick={() => openFile(`/expenses/${x.id}/file`).catch(() => toast.error("File not available"))} />}
                    <IconBtn icon={Pencil} label="Edit" onClick={() => setEditing({ ...x })} />
                    <IconBtn icon={Trash2} label="Delete" tone="danger" onClick={() => del(x)} />
                  </div>
                </td>
              </tr>
            ))}
            <tr className="bg-surface-2/60 font-semibold">
              <td className="td" colSpan={3}>{shown.length} expense{shown.length === 1 ? "" : "s"}</td>
              <td className="td text-right num hidden md:table-cell">{money(sum.net)}</td>
              <td className="td text-right num hidden md:table-cell">{money(sum.vat)}</td>
              <td className="td text-right num">{money(sum.total)}</td><td colSpan={2} />
            </tr>
          </Table>
        </>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.number}` : "Add expense"} width="max-w-lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={busy} data-testid="expense-save">Save</Button></>}>
        {editing && <ExpenseForm draft={editing} categories={cats} onChange={setEditing} />}
      </Sheet>
    </div>
  );
}
