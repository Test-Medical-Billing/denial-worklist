# Denial Worklist

Turns ERA (835) files into a daily denial work list, a summary for each practice, and a check that every payment reached the bank.

**Files never leave the computer.** The page reads them inside the web browser. Nothing is uploaded, stored on a server, or sent anywhere.

## What it does

1. **Reads ERA files**: 835 files from any payer or clearinghouse, and **Availity "Check Details" PDFs**.
2. **Sorts every denial and adjustment** into what to do next:
   - **Fix & resend**: coding or claim errors (missing modifier, wrong place of service, invalid code)
   - **Appeal**: medical necessity, level of service, authorization
   - **Check coverage**: eligibility, other insurance primary, wrong payer
   - **Review**: needs a person to decide
   - **Bill patient**: deductible, coinsurance, copay
   - **No action**: contractual adjustments
3. **Work list**, biggest dollars first, with what each code means and what to do. Filter by action, practice, payer; tick items as done.
4. **Practices**: claims, billed, paid, denial rate, money to work, top denial reasons.
5. **Payments**: matches each ERA to the EFT deposit list by trace number (or amount and date) and flags missing deposits, amount mismatches, paper checks, and deposits with no ERA. Also checks each ERA adds up.
6. **Download Excel** with all of the above, plus a Notes column for your team.

## How to use it

1. Open the page (see [SHARING.md](SHARING.md) for how your team gets it).
2. Drop today's ERA files (835 files or Availity PDFs) into **ERA files**.
3. Optional: drop the EFT deposit list (CSV) into **EFT deposits**.
4. Work the list. Download Excel to save or assign work.

Tick **Hide patient names** before sharing your screen or sending the Excel file outside the billing team.

**Try it first** with **Try with sample files**. The sample data is made up.

### EFT deposit file format

A CSV with a header row. The tool looks for columns named like:

| It needs | Column names it recognizes |
|---|---|
| Amount (required) | Amount, Credit, Deposit, Paid |
| Trace number (recommended) | Trace, TRN, EFT Number, Check Number, Reference |
| Date (recommended) | anything containing "Date" |
| Description (optional) | Description, Memo, Payer, Company, Addenda |

If your bank export uses other names, rename the header row. See `samples/sample_eft_deposits.csv`.

## Changing how codes are handled

Every denial reason code and its action lives in [`js/codes.js`](js/codes.js), one line per code:

```js
"97": [B.FIX, "Bundled: included in another service's payment", "If it was a separate service, add the right modifier and resend; otherwise write off."],
```

Change the action, meaning, or instructions to match your team's process. Codes not in the list show up as **Review**.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page |
| `css/styles.css` | Look and layout |
| `js/engine.js` | Reads 835 and EFT files, builds the work list and reconciliation |
| `js/pdf-text.js` | Reads the text inside computer-made PDFs (no outside libraries) |
| `js/availity-pdf.js` | Reads Availity "Check Details" PDF layout |
| `js/codes.js` | Denial code guide: meaning, action, what to do |
| `js/export.js`, `js/xlsx-writer.js` | Excel download (no outside libraries) |
| `js/app.js` | Screen behavior |
| `js/samples.js`, `samples/` | Made-up sample files for training |
| `tools/make-samples.js` | Regenerates the sample files (`node tools/make-samples.js`) |

## Limits

- **PDFs:** only Availity "Check Details" PDFs are supported. Every check is verified: claim lines must add up to each claim, and claims plus provider adjustments must equal the payment. If anything doesn't add up, the tool shows a warning naming the claim; check it in the PDF. Scanned PDFs can't be read. When possible, use 835 files instead: they're the original data.

- Code meanings are short summaries. Check the official [X12 claim adjustment reason codes](https://x12.org/codes/claim-adjustment-reason-codes) when in doubt.
- Remark codes (RARC) are shown but not explained yet.
- "Done" ticks are saved in each person's own browser, not shared. Use the Excel file to assign and track work across the team.
- Test with your own payers' ERA files before relying on it. Payers sometimes use 835 fields differently.

## Privacy

- Never commit real ERA, EFT, or Excel output files to this repository. `.gitignore` blocks the common file types outside `samples/`.
- The page loads one web font from Google Fonts. No file content is sent with it. For fully offline use, the page still works with the computer's default font.
