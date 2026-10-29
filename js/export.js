/* Builds the Excel workbook sheets from an analysis result. */
(function (root) {
  var Codes = typeof module !== "undefined" && module.exports ? require("./codes.js") : root.DenialCodes;

  function maskName(n) {
    if (!n) return "";
    return n.split(/\s+/).map(function (p) { return p.charAt(0) + "."; }).join(" ");
  }
  function maskId(id) {
    if (!id) return "";
    return "••••" + String(id).slice(-4);
  }

  function buildSheets(result, opts) {
    var mask = opts && opts.mask;
    var name = function (n) { return mask ? maskName(n) : n; };
    var mid = function (m) { return mask ? maskId(m) : m; };
    var done = (opts && opts.done) || {};

    var work = result.work.filter(function (w) { return w.bucket !== Codes.BUCKETS.NONE; });
    var sheets = [];

    sheets.push({
      name: "Work list",
      columns: [
        { header: "Action", key: "bucket", width: 15 },
        { header: "Amount", key: "amount", width: 11, money: true },
        { header: "Code", key: "code", width: 9 },
        { header: "What it means", key: "meaning", width: 42 },
        { header: "What to do", key: "action", width: 52 },
        { header: "Remark codes", key: "remarks", width: 13 },
        { header: "Practice", key: "practice", width: 28 },
        { header: "Payer", key: "payer", width: 26 },
        { header: "Patient", key: "patient", width: 18 },
        { header: "Member ID", key: "member", width: 14 },
        { header: "Claim #", key: "claimId", width: 12 },
        { header: "Payer claim #", key: "payerClaimNo", width: 16 },
        { header: "Date of service", key: "dos", width: 13 },
        { header: "Procedure", key: "cpt", width: 12 },
        { header: "Provider", key: "provider", width: 16 },
        { header: "Paid date", key: "paymentDate", width: 12 },
        { header: "Done", key: "done", width: 7 },
        { header: "Notes", key: "notes", width: 30 },
      ],
      rows: work.map(function (w) {
        return Object.assign({}, w, { patient: name(w.patientName), member: mid(w.memberId),
          done: done[itemKey(w)] ? "Yes" : "", notes: "" });
      }),
    });

    sheets.push({
      name: "By practice",
      columns: [
        { header: "Practice", key: "practice", width: 30 },
        { header: "Claims", key: "claims", width: 9 },
        { header: "Billed", key: "charges", width: 13, money: true },
        { header: "Paid", key: "paid", width: 13, money: true },
        { header: "Patient owes", key: "patientResp", width: 13, money: true },
        { header: "Denied claims", key: "denied", width: 13 },
        { header: "Denial rate", key: "rate", width: 11 },
        { header: "Money to work", key: "atRisk", width: 14, money: true },
        { header: "Items to work", key: "toWork", width: 12 },
        { header: "Payment problems", key: "paymentIssues", width: 16 },
        { header: "Top reasons", key: "top", width: 70 },
      ],
      rows: result.practices.map(function (p) {
        return Object.assign({}, p, { rate: Math.round(p.denialRate * 100) + "%",
          top: p.topReasons.map(function (r) { return r.code + " " + r.meaning + " ($" + r.amount.toFixed(2) + ")"; }).join("; ") });
      }),
    });

    sheets.push({
      name: "Payments",
      columns: [
        { header: "Status", key: "status", width: 30 },
        { header: "Payer", key: "payer", width: 26 },
        { header: "Practice", key: "practice", width: 28 },
        { header: "Method", key: "method", width: 8 },
        { header: "ERA date", key: "date", width: 12 },
        { header: "Trace / check #", key: "trace", width: 18 },
        { header: "ERA amount", key: "amount", width: 13, money: true },
        { header: "Deposit amount", key: "depAmount", width: 14, money: true },
        { header: "Difference", key: "difference", width: 12, money: true },
        { header: "Deposit date", key: "depDate", width: 12 },
        { header: "ERA adds up", key: "balanced", width: 11 },
        { header: "Provider adjustments", key: "plbTotal", width: 18, money: true },
        { header: "File", key: "file", width: 30 },
      ],
      rows: result.recon.rows.map(function (r) {
        return Object.assign({}, r, { depAmount: r.deposit ? r.deposit.amount : null, depDate: r.deposit ? r.deposit.date : "",
          balanced: r.balances ? "Yes" : "No" });
      }).concat(result.recon.unmatchedDeposits.map(function (d) {
        return { status: "Deposit with no ERA", payer: d.description, trace: d.trace, depAmount: d.amount, depDate: d.date, file: d.file };
      })),
    });

    sheets.push({
      name: "Claims",
      columns: [
        { header: "Result", key: "outcome", width: 15 },
        { header: "Practice", key: "practice", width: 28 },
        { header: "Payer", key: "payer", width: 26 },
        { header: "Patient", key: "patient", width: 18 },
        { header: "Member ID", key: "member", width: 14 },
        { header: "Claim #", key: "claimId", width: 12 },
        { header: "Payer claim #", key: "payerClaimNo", width: 16 },
        { header: "Date of service", key: "dos", width: 13 },
        { header: "Procedures", key: "cpts", width: 22 },
        { header: "Billed", key: "charge", width: 11, money: true },
        { header: "Paid", key: "paid", width: 11, money: true },
        { header: "Patient owes", key: "patientResp", width: 12, money: true },
        { header: "Money to work", key: "actionable", width: 13, money: true },
        { header: "Payer status", key: "status", width: 26 },
      ],
      rows: result.claims.map(function (c) {
        return Object.assign({}, c, { patient: name(c.patientName), member: mid(c.memberId) });
      }),
    });

    if (result.plb.length) {
      sheets.push({
        name: "Provider adjustments",
        columns: [
          { header: "Payer", key: "payer", width: 26 },
          { header: "Practice", key: "practice", width: 28 },
          { header: "Reason code", key: "reason", width: 12 },
          { header: "Reference", key: "reference", width: 20 },
          { header: "Amount", key: "amount", width: 12, money: true },
          { header: "Trace", key: "trace", width: 18 },
        ],
        rows: result.plb,
      });
    }

    sheets.push({
      name: "Code guide",
      columns: [
        { header: "Code", key: "code", width: 8 },
        { header: "Action", key: "bucket", width: 15 },
        { header: "What it means", key: "meaning", width: 55 },
        { header: "What to do", key: "action", width: 70 },
      ],
      rows: Object.keys(Codes.CARC).map(function (k) {
        var e = Codes.CARC[k];
        return { code: k, bucket: e[0], meaning: e[1], action: e[2] };
      }),
    });
    return sheets;
  }

  function itemKey(w) {
    return [w.trace, w.claimId, w.cpt, w.code, w.amount].join("|");
  }

  var api = { buildSheets: buildSheets, maskName: maskName, maskId: maskId, itemKey: itemKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DenialExport = api;
})(this);
