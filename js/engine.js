/*
 * Denial Agent engine: reads ERA (X12 835) files and EFT deposit CSVs,
 * builds the denial work list, claim list, practice summaries and payment reconciliation.
 * Runs entirely in the browser (or in Node for tests). Nothing is sent anywhere.
 */
(function (root) {
  var Codes = typeof module !== "undefined" && module.exports ? require("./codes.js") : root.DenialCodes;
  var B = Codes.BUCKETS;

  var CLAIM_STATUS = {
    "1": "Processed as primary",
    "2": "Processed as secondary",
    "3": "Processed as tertiary",
    "4": "Denied",
    "19": "Processed as primary, forwarded",
    "20": "Processed as secondary, forwarded",
    "21": "Processed as tertiary, forwarded",
    "22": "Reversal of previous payment",
    "23": "Not our claim, forwarded",
    "25": "Predetermination only",
  };

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  function round2(n) {
    return Math.round(n * 100) / 100;
  }
  function ediDate(d) {
    if (!d || d.length !== 8) return d || "";
    return d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
  }

  // ---------- 835 parsing ----------
  function parse835(text, fileName) {
    var start = text.indexOf("ISA");
    if (start < 0) throw new Error(fileName + ": not an 835 file (no ISA segment found)");
    text = text.slice(start);
    var elSep = text.charAt(3);
    var compSep = text.charAt(104);
    var segTerm = text.charAt(105);
    var segments = text
      .split(segTerm)
      .map(function (s) { return s.replace(/^[\r\n\s]+|[\r\n\s]+$/g, ""); })
      .filter(Boolean)
      .map(function (s) { return s.split(elSep); });

    var txns = [];
    var txn = null, claim = null, svc = null, lastN1 = null;

    function addCas(e, target, level) {
      for (var i = 2; i + 1 < e.length && i <= 17; i += 3) {
        if (!e[i]) continue;
        target.adjustments.push({ group: e[1], code: e[i], amount: num(e[i + 1]), level: level });
      }
    }

    segments.forEach(function (e) {
      var id = e[0];
      switch (id) {
        case "ST":
          txn = { file: fileName, payer: "", payerId: "", payee: "", payeeNPI: "", payeeTIN: "",
            amount: 0, method: "", paymentDate: "", trace: "", claims: [], plb: [] };
          txns.push(txn);
          claim = svc = null;
          break;
        case "BPR":
          if (!txn) break;
          txn.amount = num(e[2]);
          txn.method = e[4] || "";
          txn.paymentDate = ediDate(e[16]);
          break;
        case "TRN":
          if (!txn) break;
          txn.trace = e[2] || "";
          txn.payerId = e[3] || "";
          break;
        case "N1":
          if (!txn) break;
          lastN1 = e[1];
          if (e[1] === "PR") txn.payer = e[2] || "";
          if (e[1] === "PE") {
            txn.payee = e[2] || "";
            if (e[3] === "XX") txn.payeeNPI = e[4] || "";
            if (e[3] === "FI") txn.payeeTIN = e[4] || "";
          }
          break;
        case "REF":
          if (txn && lastN1 === "PE" && !claim && e[1] === "TJ") txn.payeeTIN = e[2] || "";
          break;
        case "CLP":
          if (!txn) break;
          claim = { patientControl: e[1] || "", statusCode: e[2] || "", status: CLAIM_STATUS[e[2]] || ("Status " + e[2]),
            charge: num(e[3]), paid: num(e[4]), patientResp: num(e[5]), payerClaimNo: e[7] || "",
            patientName: "", memberId: "", renderingName: "", renderingNPI: "", dos: "",
            adjustments: [], services: [], remarks: [] };
          txn.claims.push(claim);
          svc = null;
          lastN1 = null;
          break;
        case "NM1":
          if (!claim) break;
          if (e[1] === "QC") {
            claim.patientName = [e[4], e[3]].filter(Boolean).join(" ");
            if (e[9]) claim.memberId = e[9];
          } else if (e[1] === "IL" && !claim.memberId) {
            claim.memberId = e[9] || "";
          } else if (e[1] === "82") {
            claim.renderingName = [e[4], e[3]].filter(Boolean).join(" ");
            claim.renderingNPI = e[9] || "";
          }
          break;
        case "MOA":
        case "MIA":
          if (!claim) break;
          e.slice(1).forEach(function (v) {
            if (/^[A-Z]{1,2}\d+$/.test(v)) claim.remarks.push(v);
          });
          break;
        case "DTM":
          if (svc && e[1] === "472") svc.dos = ediDate(e[2]);
          else if (claim && !svc && (e[1] === "232" || e[1] === "472")) {
            if (!claim.dos) claim.dos = ediDate(e[2]);
          }
          break;
        case "SVC":
          if (!claim) break;
          var parts = (e[1] || "").split(compSep);
          svc = { code: parts[1] || "", modifiers: parts.slice(2).filter(Boolean), charge: num(e[2]), paid: num(e[3]),
            units: e[5] || "", dos: "", adjustments: [], remarks: [] };
          claim.services.push(svc);
          break;
        case "CAS":
          if (svc) addCas(e, svc, "service");
          else if (claim) addCas(e, claim, "claim");
          break;
        case "LQ":
          if (e[1] === "HE") {
            if (svc) svc.remarks.push(e[2]);
            else if (claim) claim.remarks.push(e[2]);
          }
          break;
        case "PLB":
          if (!txn) break;
          for (var i = 3; i + 1 < e.length; i += 2) {
            if (!e[i]) continue;
            var rc = e[i].split(compSep);
            txn.plb.push({ providerId: e[1] || "", date: ediDate(e[2]), reason: rc[0], reference: rc[1] || "", amount: num(e[i + 1]) });
          }
          break;
        case "SE":
          claim = svc = null;
          break;
      }
    });

    if (!txns.length) throw new Error(fileName + ": no payment transactions (ST segments) found");
    txns.forEach(function (t) {
      t.claims.forEach(function (c) {
        if (!c.dos && c.services.length) c.dos = c.services[0].dos;
      });
    });
    return txns;
  }

  // ---------- CSV parsing (EFT deposits) ----------
  function parseCSV(text) {
    var rows = [], row = [], field = "", inQuotes = false;
    text = text.replace(/^﻿/, "");
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(function (c) { return c.trim() !== ""; })) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(function (c) { return c.trim() !== ""; })) rows.push(row);
    return rows;
  }

  function parseMoney(v) {
    if (v == null) return NaN;
    var s = String(v).trim();
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    var n = parseFloat(s.replace(/[^0-9.]/g, ""));
    return isNaN(n) ? NaN : neg ? -n : n;
  }

  function parseAnyDate(v) {
    var s = String(v || "").trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + "-" + pad(m[2]) + "-" + pad(m[3]);
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {
      var y = m[3].length === 2 ? "20" + m[3] : m[3];
      return y + "-" + pad(m[1]) + "-" + pad(m[2]);
    }
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return m[1] + "-" + m[2] + "-" + m[3];
    return s;
  }
  function pad(x) { return ("0" + x).slice(-2); }

  // Guess which columns hold the trace number, amount, date and description.
  function detectEftColumns(header) {
    var h = header.map(function (c) { return String(c).toLowerCase(); });
    function find(words) {
      for (var w = 0; w < words.length; w++)
        for (var i = 0; i < h.length; i++) if (h[i].indexOf(words[w]) >= 0) return i;
      return -1;
    }
    return {
      trace: find(["trace", "trn", "eft number", "eft #", "check number", "check #", "reference", "ref"]),
      amount: find(["amount", "credit", "deposit", "paid"]),
      date: find(["date"]),
      description: find(["description", "detail", "memo", "payer", "company", "originator", "addenda"]),
    };
  }

  function readEft(text, fileName, columns) {
    var rows = parseCSV(text);
    if (rows.length < 2) throw new Error(fileName + ": EFT file needs a header row and at least one deposit");
    var header = rows[0];
    var cols = columns || detectEftColumns(header);
    if (cols.amount < 0) throw new Error(fileName + ": couldn't find an amount column. Rename it to 'Amount'.");
    var out = [];
    rows.slice(1).forEach(function (r, idx) {
      var amount = parseMoney(r[cols.amount]);
      if (isNaN(amount) || amount === 0) return;
      out.push({
        file: fileName, row: idx + 2,
        trace: cols.trace >= 0 ? String(r[cols.trace] || "").trim() : "",
        amount: amount,
        date: cols.date >= 0 ? parseAnyDate(r[cols.date]) : "",
        description: cols.description >= 0 ? String(r[cols.description] || "").trim() : "",
      });
    });
    return { header: header, columns: cols, deposits: out };
  }

  // ---------- analysis ----------
  function normTrace(t) {
    return String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  }
  function daysBetween(a, b) {
    var da = Date.parse(a), db = Date.parse(b);
    if (isNaN(da) || isNaN(db)) return Infinity;
    return Math.abs(da - db) / 864e5;
  }

  function claimOutcome(c) {
    if (c.statusCode === "22") return "Reversed";
    if (c.statusCode === "4") return "Denied";
    if (c.paid === 0 && c.charge > 0) return c.patientResp > 0 && c.patientResp >= c.charge - 0.01 ? "Patient owes all" : "Denied";
    var open = c.charge - c.paid - c.patientResp - sumAdj(c, function (a) {
      return a.group !== "PR" && Codes.classify(a.group, a.code).bucket === B.NONE;
    });
    return open > 0.01 ? "Partially paid" : "Paid";
  }
  function allAdjustments(c) {
    var list = c.adjustments.map(function (a) { return Object.assign({ service: null }, a); });
    c.services.forEach(function (s) {
      s.adjustments.forEach(function (a) { list.push(Object.assign({ service: s }, a)); });
    });
    return list;
  }
  function sumAdj(c, pred) {
    return allAdjustments(c).filter(pred).reduce(function (t, a) { return t + a.amount; }, 0);
  }

  function analyze(txns, eft) {
    var claims = [], work = [], payments = [], plb = [];
    txns.forEach(function (t) {
      var claimsPaid = t.claims.reduce(function (s, c) { return s + c.paid; }, 0);
      var plbTotal = t.plb.reduce(function (s, p) { return s + p.amount; }, 0);
      var balances = Math.abs(round2(claimsPaid - plbTotal) - round2(t.amount)) < 0.01;
      payments.push({ file: t.file, payer: t.payer, practice: t.payee, practiceNPI: t.payeeNPI, trace: t.trace,
        method: t.method, date: t.paymentDate, amount: t.amount, claimCount: t.claims.length,
        claimsPaid: round2(claimsPaid), plbTotal: round2(plbTotal), balances: balances });
      t.plb.forEach(function (p) {
        plb.push(Object.assign({ payer: t.payer, practice: t.payee, trace: t.trace, file: t.file }, p));
      });

      t.claims.forEach(function (c) {
        var outcome = claimOutcome(c);
        var claimRow = { practice: t.payee, payer: t.payer, patientName: c.patientName, memberId: c.memberId,
          claimId: c.patientControl, payerClaimNo: c.payerClaimNo, dos: c.dos, provider: c.renderingName,
          status: c.status, outcome: outcome, charge: c.charge, paid: c.paid, patientResp: c.patientResp,
          cpts: c.services.map(function (s) { return s.code + (s.modifiers.length ? "-" + s.modifiers.join("-") : ""); }).join(", "),
          trace: t.trace, file: t.file, actionable: 0 };
        claims.push(claimRow);

        if (c.statusCode === "22") {
          work.push(makeItem(t, c, null, { group: "CR", code: "22", amount: -c.paid }, {
            bucket: B.REVIEW, meaning: "Payer reversed a previous payment", action: "Find the corrected claim in this or a later ERA; check the recoupment." }));
        }
        allAdjustments(c).forEach(function (a) {
          if (a.amount === 0) return;
          var cls = Codes.classify(a.group, a.code);
          if (c.statusCode === "22") return; // reversal handled above
          var item = makeItem(t, c, a.service, a, cls);
          work.push(item);
          if (item.bucket !== B.NONE && item.bucket !== B.PATIENT) claimRow.actionable += a.amount;
        });
        claimRow.actionable = round2(claimRow.actionable);
      });
    });

    var recon = reconcile(payments, eft ? eft.deposits : null);
    var practices = summarize(claims, work, recon);
    work.sort(function (a, b) { return b.amount - a.amount; });
    return { claims: claims, work: work, payments: payments, plb: plb, recon: recon, practices: practices,
      eftColumns: eft ? eft.columns : null, eftHeader: eft ? eft.header : null };
  }

  function makeItem(t, c, s, a, cls) {
    return {
      bucket: cls.bucket, amount: round2(a.amount), code: a.group + "-" + a.code, group: a.group, carc: a.code,
      meaning: cls.meaning, action: cls.action,
      remarks: (s ? s.remarks : []).concat(c.remarks).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).join(", "),
      practice: t.payee, payer: t.payer, patientName: c.patientName, memberId: c.memberId,
      claimId: c.patientControl, payerClaimNo: c.payerClaimNo, dos: (s && s.dos) || c.dos,
      cpt: s ? s.code + (s.modifiers.length ? "-" + s.modifiers.join("-") : "") : "Whole claim",
      charge: s ? s.charge : c.charge, provider: c.renderingName, claimStatus: c.status,
      paymentDate: t.paymentDate, trace: t.trace, file: t.file,
    };
  }

  function reconcile(payments, deposits) {
    var rows = [];
    if (!deposits) {
      payments.forEach(function (p) {
        rows.push(Object.assign({}, p, { status: p.method === "NON" || p.amount === 0 ? "No payment" : "No EFT file loaded",
          deposit: null, difference: null }));
      });
      return { rows: rows, unmatchedDeposits: [], hasEft: false };
    }
    var used = deposits.map(function () { return false; });
    payments.forEach(function (p) {
      var row = Object.assign({}, p, { deposit: null, difference: null, status: "" });
      if (p.method === "NON" || p.amount === 0) { row.status = "No payment"; rows.push(row); return; }
      var t = normTrace(p.trace), idx = -1;
      if (t.length >= 4) {
        idx = deposits.findIndex(function (d, i) {
          if (used[i]) return false;
          var dt = normTrace(d.trace);
          return (dt && dt === t) || (t.length >= 6 && normTrace(d.description).indexOf(t) >= 0);
        });
      }
      var byTrace = idx >= 0;
      if (idx < 0) {
        idx = deposits.findIndex(function (d, i) {
          return !used[i] && Math.abs(d.amount - p.amount) < 0.01 && daysBetween(d.date, p.date) <= 7;
        });
      }
      if (idx >= 0) {
        used[idx] = true;
        var d = deposits[idx];
        row.deposit = d;
        row.difference = round2(d.amount - p.amount);
        if (Math.abs(row.difference) < 0.01) row.status = byTrace ? "Matched" : "Matched by amount and date";
        else row.status = "Amount mismatch";
      } else {
        row.status = p.method === "CHK" ? "Paper check: match to check deposit" : "No deposit found";
      }
      rows.push(row);
    });
    var unmatched = deposits.filter(function (d, i) { return !used[i]; });
    return { rows: rows, unmatchedDeposits: unmatched, hasEft: true };
  }

  function summarize(claims, work, recon) {
    var map = {};
    function get(name) {
      if (!map[name]) map[name] = { practice: name, claims: 0, charges: 0, paid: 0, patientResp: 0, denied: 0,
        partial: 0, atRisk: 0, toWork: 0, buckets: {}, reasons: {}, payers: {} };
      return map[name];
    }
    claims.forEach(function (c) {
      var p = get(c.practice || "Unknown practice");
      p.claims++; p.charges += c.charge; p.paid += c.paid; p.patientResp += c.patientResp;
      if (c.outcome === "Denied") p.denied++;
      if (c.outcome === "Partially paid") p.partial++;
      p.payers[c.payer] = (p.payers[c.payer] || 0) + 1;
    });
    work.forEach(function (w) {
      var p = get(w.practice || "Unknown practice");
      p.buckets[w.bucket] = (p.buckets[w.bucket] || 0) + w.amount;
      if (w.bucket === B.NONE || w.bucket === B.PATIENT) return;
      p.atRisk += w.amount; p.toWork++;
      var key = w.code + "|" + w.meaning;
      if (!p.reasons[key]) p.reasons[key] = { code: w.code, meaning: w.meaning, bucket: w.bucket, amount: 0, count: 0 };
      p.reasons[key].amount += w.amount; p.reasons[key].count++;
    });
    return Object.keys(map).sort().map(function (k) {
      var p = map[k];
      p.charges = round2(p.charges); p.paid = round2(p.paid); p.patientResp = round2(p.patientResp); p.atRisk = round2(p.atRisk);
      p.denialRate = p.claims ? p.denied / p.claims : 0;
      p.topReasons = Object.keys(p.reasons).map(function (r) { p.reasons[r].amount = round2(p.reasons[r].amount); return p.reasons[r]; })
        .sort(function (a, b) { return b.amount - a.amount; }).slice(0, 5);
      var rec = recon.rows.filter(function (r) { return r.practice === k; });
      p.paymentIssues = rec.filter(function (r) { return r.status === "Amount mismatch" || r.status === "No deposit found"; }).length;
      return p;
    });
  }

  var api = { parse835: parse835, parseCSV: parseCSV, readEft: readEft, detectEftColumns: detectEftColumns,
    analyze: analyze, CLAIM_STATUS: CLAIM_STATUS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DenialEngine = api;
})(this);
