// Generates FAKE sample ERA (835) and EFT files for training and testing.
// All names, IDs and numbers are invented. Run: node tools/make-samples.js
const fs = require("fs");
const path = require("path");

function pad(s, n) { return String(s).padEnd(n, " ").slice(0, n); }
function isa(ctrl) {
  const seg = ["ISA", "00", pad("", 10), "00", pad("", 10), "ZZ", pad("SAMPLEPAYER", 15), "ZZ",
    pad("SAMPLEBILLING", 15), "261028", "1200", "^", "00501", String(ctrl).padStart(9, "0"), "0", "T", ":"].join("*") + "~";
  if (seg.length !== 106) throw new Error("ISA length " + seg.length);
  return seg;
}

let ctrl = 1;
function era({ payer, payerId, practice, npi, tin, method, date, trace, claims, plb = [] }) {
  const segs = [];
  const st = String(ctrl).padStart(4, "0");
  segs.push(`GS*HP*${payerId}*SAMPLEBILLING*20261028*1200*${ctrl}*X*005010X221A1`);
  segs.push(`ST*835*${st}`);
  const paidTotal = claims.reduce((s, c) => s + c.paid, 0) - plb.reduce((s, p) => s + p.amount, 0);
  const amt = paidTotal.toFixed(2);
  segs.push(`BPR*I*${amt}*C*${method}*CCP*01*999999999*DA*123456*1${payerId}**01*888888888*DA*654321*${date}`);
  segs.push(`TRN*1*${trace}*1${payerId}`);
  segs.push(`DTM*405*${date}`);
  segs.push(`N1*PR*${payer}`);
  segs.push(`N1*PE*${practice}*XX*${npi}`);
  segs.push(`REF*TJ*${tin}`);
  segs.push(`LX*1`);
  for (const c of claims) {
    const charge = c.lines.reduce((s, l) => s + l.charge, 0);
    segs.push(`CLP*${c.id}*${c.status || 1}*${charge.toFixed(2)}*${c.paid.toFixed(2)}*${(c.pr || 0).toFixed(2)}*12*${c.payerNo}`);
    segs.push(`NM1*QC*1*${c.last}*${c.first}****MI*${c.member}`);
    segs.push(`NM1*82*1*${c.provLast}*${c.provFirst}****XX*${c.provNpi}`);
    if (c.remarks) segs.push(`MOA***${c.remarks}`);
    segs.push(`DTM*232*${c.dos}`);
    for (const l of c.lines) {
      segs.push(`SVC*HC:${l.code}${l.mods ? ":" + l.mods : ""}*${l.charge.toFixed(2)}*${l.paid.toFixed(2)}**1`);
      segs.push(`DTM*472*${c.dos}`);
      for (const a of l.cas || []) segs.push(`CAS*${a[0]}*${a[1]}*${a[2].toFixed(2)}`);
      for (const r of l.rarc || []) segs.push(`LQ*HE*${r}`);
    }
  }
  for (const p of plb) segs.push(`PLB*${npi}*20261231*${p.reason}:${p.ref}*${p.amount.toFixed(2)}`);
  segs.push(`SE*${segs.length}*${st}`);
  segs.push(`GE*1*${ctrl}`);
  const text = isa(ctrl) + segs.join("~") + "~" + `IEA*1*${String(ctrl).padStart(9, "0")}~`;
  ctrl++;
  return text;
}

const prov = {
  garcia: { provLast: "GARCIA", provFirst: "ANA", provNpi: "1000000001" },
  np: { provLast: "LEE", provFirst: "JORDAN", provNpi: "1000000002" },
  bh: { provLast: "KHAN", provFirst: "SARA", provNpi: "1000000003" },
  peds: { provLast: "PATEL", provFirst: "RAVI", provNpi: "1000000004" },
};

const files = {};

files["sample_garcia_medicare.835"] = era({
  payer: "SAMPLE MEDICARE CONTRACTOR", payerId: "MCR01", practice: "GARCIA INTERNAL MEDICINE", npi: "1999999991", tin: "111111111",
  method: "ACH", date: "20261020", trace: "EFT0001234567",
  claims: [
    { id: "GIM1001", payerNo: "2026293000101", last: "TESTER", first: "ALICE", member: "TST000001A", dos: "20261001", paid: 98.76, pr: 25.18, ...prov.garcia,
      lines: [{ code: "99214", charge: 185, paid: 98.76, cas: [["CO", "45", 59.04], ["PR", "2", 25.18], ["CO", "253", 2.02]] }] },
    { id: "GIM1002", payerNo: "2026293000102", last: "SAMPLE", first: "BEN", member: "TST000002A", dos: "20261002", paid: 0, pr: 0, ...prov.garcia, remarks: "N180",
      lines: [{ code: "99214", charge: 185, paid: 0, cas: [["CO", "4", 185]], rarc: ["M80"] },
              { code: "G0439", charge: 210, paid: 0, cas: [["CO", "236", 210]] }] },
    { id: "GIM1003", payerNo: "2026293000103", last: "EXAMPLE", first: "CARLA", member: "TST000003A", dos: "20261003", paid: 0, pr: 0, ...prov.garcia,
      lines: [{ code: "99215", charge: 260, paid: 0, cas: [["CO", "150", 260]], rarc: ["N115"] }] },
    { id: "GIM1004", payerNo: "2026293000104", last: "DEMO", first: "DAVID", member: "TST000004A", dos: "20261006", paid: 0, pr: 0, ...prov.np,
      lines: [{ code: "99213", charge: 140, paid: 0, cas: [["CO", "185", 140]] }] },
  ],
  plb: [{ reason: "L6", ref: "INTEREST", amount: -1.25 }],
});

files["sample_garcia_commercial.835"] = era({
  payer: "SAMPLE HEALTH PLAN", payerId: "SHP02", practice: "GARCIA INTERNAL MEDICINE", npi: "1999999991", tin: "111111111",
  method: "ACH", date: "20261021", trace: "778899001",
  claims: [
    { id: "GIM1005", payerNo: "SHP5550001", last: "MOCK", first: "ELLEN", member: "SHPX11111", dos: "20261007", paid: 0, pr: 0, ...prov.garcia,
      lines: [{ code: "99213", charge: 140, paid: 0, cas: [["CO", "27", 140]] }] },
    { id: "GIM1006", payerNo: "SHP5550002", last: "TRIAL", first: "FRANK", member: "SHPX22222", dos: "20261008", paid: 92.5, pr: 30, ...prov.garcia,
      lines: [{ code: "99214", charge: 185, paid: 92.5, cas: [["CO", "45", 62.5], ["PR", "3", 30]] }] },
    { id: "GIM1007", payerNo: "SHP5550003", last: "PILOT", first: "GRACE", member: "SHPX33333", dos: "20261009", paid: 0, pr: 0, ...prov.garcia,
      lines: [{ code: "99396", charge: 250, paid: 0, cas: [["CO", "197", 250]] }] },
  ],
});

files["sample_behavioral_health.835"] = era({
  payer: "SAMPLE BEHAVIORAL PLAN", payerId: "SBP03", practice: "MINDWELL BEHAVIORAL HEALTH", npi: "1999999992", tin: "222222222",
  method: "ACH", date: "20261022", trace: "BH20261022A",
  claims: [
    { id: "BH2001", payerNo: "SBP9001", last: "NOTREAL", first: "HANNAH", member: "SBP100001", dos: "20261005", paid: 75, pr: 20, ...prov.bh,
      lines: [{ code: "99214", charge: 175, paid: 75, cas: [["CO", "45", 80], ["PR", "3", 20]] },
              { code: "90833", charge: 110, paid: 0, cas: [["CO", "16", 110]], rarc: ["M67"] }] },
    { id: "BH2002", payerNo: "SBP9002", last: "PLACEHOLDER", first: "IAN", member: "SBP100002", dos: "20261012", paid: 0, pr: 0, ...prov.bh,
      lines: [{ code: "90837", mods: "95", charge: 200, paid: 0, cas: [["CO", "5", 200]] }] },
    { id: "BH2003", payerNo: "SBP9003", last: "FICTION", first: "JADE", member: "SBP100003", dos: "20261013", paid: 0, pr: 0, ...prov.bh, status: 4,
      lines: [{ code: "90792", charge: 300, paid: 0, cas: [["CO", "50", 300]] }] },
  ],
});

files["sample_pediatrics_medicaid.835"] = era({
  payer: "SAMPLE STATE MEDICAID", payerId: "SSM04", practice: "LITTLE STEPS PEDIATRICS", npi: "1999999993", tin: "333333333",
  method: "ACH", date: "20261023", trace: "MCD000555",
  claims: [
    { id: "PED3001", payerNo: "MCD70001", last: "KIDTEST", first: "LEO", member: "MCDK00001", dos: "20261014", paid: 0, pr: 0, ...prov.peds,
      lines: [{ code: "99393", charge: 180, paid: 0, cas: [["CO", "6", 180]] }] },
    { id: "PED3002", payerNo: "MCD70002", last: "KIDTEST", first: "MIA", member: "MCDK00002", dos: "20261014", paid: 120, pr: 0, ...prov.peds,
      lines: [{ code: "99392", charge: 170, paid: 120, cas: [["CO", "45", 50]] },
              { code: "90460", charge: 40, paid: 0, cas: [["CO", "97", 40]] }] },
    { id: "PED3003", payerNo: "MCD70003", last: "KIDTEST", first: "NOAH", member: "MCDK00003", dos: "20261015", paid: 0, pr: 0, ...prov.peds,
      lines: [{ code: "99213", mods: "25", charge: 130, paid: 0, cas: [["CO", "22", 130]] }] },
  ],
});

files["sample_pediatrics_check.835"] = era({
  payer: "SAMPLE KIDS PLAN", payerId: "SKP05", practice: "LITTLE STEPS PEDIATRICS", npi: "1999999993", tin: "333333333",
  method: "CHK", date: "20261024", trace: "CHK44021",
  claims: [
    { id: "PED3004", payerNo: "SKP1001", last: "KIDTEST", first: "OLIVIA", member: "SKP00009", dos: "20261016", paid: 88, pr: 0, ...prov.peds,
      lines: [{ code: "99213", charge: 130, paid: 88, cas: [["CO", "45", 42]] }] },
  ],
});

const eftCsv = [
  "Date,Description,Trace Number,Amount",
  "10/20/2026,ACH CREDIT SAMPLE MEDICARE HCCLAIMPMT,EFT0001234567,100.01",
  "10/21/2026,ACH CREDIT SAMPLE HEALTH PLAN HCCLAIMPMT,778899001,92.50",
  "10/22/2026,ACH CREDIT SAMPLE BEHAVIORAL HCCLAIMPMT,BH20261022A,70.00",
  "10/24/2026,ACH CREDIT SAMPLE DENTAL HCCLAIMPMT,DEN555,145.00",
].join("\n") + "\n";
// Note: Medicaid ERA (MCD000555, 120.00) has no deposit; behavioral deposit is 5.00 short.

const outDir = path.join(__dirname, "..", "samples");
fs.mkdirSync(outDir, { recursive: true });
for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), text);
fs.writeFileSync(path.join(outDir, "sample_eft_deposits.csv"), eftCsv);

// Also embed in a script so "Try sample files" works when index.html is opened straight from disk.
const js = "// FAKE sample data generated by tools/make-samples.js. Do not edit by hand.\n" +
  "window.DENIAL_SAMPLES = " + JSON.stringify({ eras: files, eft: { "sample_eft_deposits.csv": eftCsv } }, null, 1) + ";\n";
fs.writeFileSync(path.join(__dirname, "..", "js", "samples.js"), js);
console.log("Wrote", Object.keys(files).length, "ERA files + EFT CSV to samples/ and js/samples.js");
