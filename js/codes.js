/*
 * Claim Adjustment Reason Codes (CARC) -> plain-English meaning and action bucket.
 * Meanings are short summaries for billers. The official list is maintained by X12:
 * https://x12.org/codes/claim-adjustment-reason-codes
 * Edit this file to match how your team works each code.
 */
(function (root) {
  var B = {
    FIX: "Fix & resend",
    APPEAL: "Appeal",
    COVERAGE: "Check coverage",
    PATIENT: "Bill patient",
    REVIEW: "Review",
    NONE: "No action",
  };

  // code: [bucket, meaning, what to do]
  var CARC = {
    "1": [B.PATIENT, "Deductible", "Bill the patient for the deductible amount."],
    "2": [B.PATIENT, "Coinsurance", "Bill the patient for the coinsurance amount."],
    "3": [B.PATIENT, "Copay", "Collect the copay from the patient if not collected at the visit."],
    "4": [B.FIX, "Procedure code doesn't match the modifier, or a required modifier is missing", "Check modifiers (e.g. 25, 59) against the note and send a corrected claim."],
    "5": [B.FIX, "Procedure code doesn't match the place of service", "Correct the place of service (e.g. telehealth 02/10) and resend."],
    "6": [B.FIX, "Procedure doesn't fit the patient's age", "Check the code against the patient's age (e.g. well-child age bands) and resend."],
    "7": [B.FIX, "Procedure doesn't fit the patient's sex", "Check the code and patient demographics, then resend."],
    "8": [B.FIX, "Procedure doesn't fit the provider type or specialty", "Check rendering provider and taxonomy on the claim; resend."],
    "9": [B.FIX, "Diagnosis doesn't fit the patient's age", "Review the diagnosis code and resend."],
    "10": [B.FIX, "Diagnosis doesn't fit the patient's sex", "Review the diagnosis code and resend."],
    "11": [B.FIX, "Diagnosis doesn't support the procedure", "Check diagnosis pointers and codes against the note; resend or appeal with records."],
    "13": [B.COVERAGE, "Date of death is before the date of service", "Verify patient information and dates."],
    "15": [B.FIX, "Authorization number missing, invalid, or doesn't apply", "Add the correct authorization number and resend."],
    "16": [B.FIX, "Claim is missing information or has a billing error", "Read the remark code to see what's missing, fix, and resend."],
    "18": [B.REVIEW, "Duplicate claim or service", "Check the status of the original claim; don't resend unless it was a different service."],
    "19": [B.COVERAGE, "Work injury: workers' compensation should pay", "Get workers' comp carrier details and bill them."],
    "20": [B.COVERAGE, "Injury covered by a liability carrier", "Get liability carrier details and bill them."],
    "21": [B.COVERAGE, "No-fault carrier should pay", "Get the no-fault carrier details and bill them."],
    "22": [B.COVERAGE, "Another insurance may be primary", "Confirm coordination of benefits with the patient; bill the primary payer."],
    "23": [B.NONE, "Adjusted because of the prior payer's payment", "Normal for secondary claims. No action unless the amount looks wrong."],
    "24": [B.COVERAGE, "Covered under a capitation or managed care plan", "Check the patient's plan; bill the managed care plan if needed."],
    "26": [B.COVERAGE, "Service was before coverage started", "Verify eligibility dates; find the correct payer or bill the patient."],
    "27": [B.COVERAGE, "Service was after coverage ended", "Verify eligibility; find new insurance or bill the patient."],
    "29": [B.APPEAL, "Timely filing limit passed", "Appeal only if you have proof of timely submission; otherwise write off."],
    "31": [B.COVERAGE, "Patient can't be identified as a member", "Verify member ID, name and date of birth; resend."],
    "32": [B.COVERAGE, "Patient is not an eligible dependent", "Verify eligibility with the patient and payer."],
    "33": [B.COVERAGE, "Insured has no dependent coverage", "Verify coverage; find the correct payer or bill the patient."],
    "34": [B.COVERAGE, "No coverage for newborns", "Add the newborn to the policy or bill the correct payer."],
    "39": [B.APPEAL, "Authorization was denied when requested", "Appeal with medical records if the service was necessary."],
    "40": [B.APPEAL, "Doesn't meet emergency or urgent care criteria", "Appeal with records showing urgency."],
    "45": [B.NONE, "Charge is above the fee schedule or contracted rate", "Contractual adjustment. No action unless the allowed amount is wrong."],
    "49": [B.REVIEW, "Routine or preventive service not covered", "Check preventive coding; bill the patient only if allowed (waiver on file)."],
    "50": [B.APPEAL, "Not medically necessary", "Appeal with the note and supporting records."],
    "51": [B.REVIEW, "Pre-existing condition not covered", "Review the policy; appeal or bill the patient as allowed."],
    "55": [B.APPEAL, "Treatment considered experimental", "Appeal with supporting evidence if appropriate."],
    "56": [B.APPEAL, "Treatment not proven effective", "Appeal with supporting evidence if appropriate."],
    "58": [B.FIX, "Wrong setting or place of service", "Correct the place of service and resend."],
    "59": [B.REVIEW, "Reduced under multiple or same-day procedure rules", "Usually expected. Review if the reduction looks wrong."],
    "94": [B.NONE, "Processed in excess of charges", "No action."],
    "96": [B.REVIEW, "Non-covered charge", "Read the remark code; bill the patient only if allowed, otherwise write off or appeal."],
    "97": [B.FIX, "Bundled: included in another service's payment", "If it was a separate service, add the right modifier and resend; otherwise write off."],
    "100": [B.PATIENT, "Payment was made to the patient", "Collect the payment from the patient."],
    "107": [B.FIX, "Related or qualifying claim/service not identified", "Add the related claim or service information and resend."],
    "109": [B.COVERAGE, "Not covered by this payer; send to the correct payer", "Find the correct payer (e.g. Medicare Advantage plan) and bill them."],
    "110": [B.FIX, "Billing date is before the service date", "Correct the dates and resend."],
    "119": [B.REVIEW, "Benefit maximum reached", "Check benefits; bill the patient if their plan allows."],
    "125": [B.FIX, "Submission or billing error", "Read the remark code, fix the claim, and resend."],
    "129": [B.FIX, "Prior payer information looks wrong", "Correct the primary payer's payment details and resend the secondary claim."],
    "131": [B.NONE, "Claim-specific negotiated discount", "No action."],
    "140": [B.FIX, "Member ID and patient name don't match", "Correct the patient name or member ID and resend."],
    "146": [B.FIX, "Diagnosis code invalid for the date of service", "Update to a valid diagnosis code and resend."],
    "150": [B.APPEAL, "Documentation doesn't support this level of service", "Review the E/M level against the note; recode and resend, or appeal with records."],
    "151": [B.APPEAL, "Documentation doesn't support this many services or this frequency", "Appeal with records, or correct units."],
    "167": [B.REVIEW, "Diagnosis not covered", "Check the diagnosis coding; resend if wrong, otherwise appeal or write off."],
    "170": [B.FIX, "Not paid when billed by this type of provider", "Check which provider billed and their credentials; resend if needed."],
    "181": [B.FIX, "Procedure code invalid for the date of service", "Update to a valid code and resend."],
    "182": [B.FIX, "Modifier invalid for the date of service", "Correct the modifier and resend."],
    "183": [B.FIX, "Referring provider not eligible to refer", "Correct the referring provider and resend."],
    "185": [B.FIX, "Rendering provider not eligible for this service", "Check provider enrollment/credentialing with this payer."],
    "189": [B.FIX, "Unlisted code used when a specific code exists", "Use the specific procedure code and resend."],
    "197": [B.APPEAL, "Authorization or referral missing", "If an authorization existed, add it and resend; if not, request a retro auth or appeal."],
    "198": [B.APPEAL, "Authorized number of services exceeded", "Request an extension or appeal."],
    "199": [B.FIX, "Revenue code and procedure code don't match", "Correct the codes and resend."],
    "204": [B.REVIEW, "Not covered under the patient's current plan", "Bill the patient only if allowed (waiver on file); otherwise write off."],
    "206": [B.FIX, "NPI missing", "Add the NPI and resend."],
    "207": [B.FIX, "NPI invalid", "Correct the NPI and resend."],
    "208": [B.FIX, "NPI doesn't match the provider", "Check the NPI against enrollment and resend."],
    "226": [B.FIX, "Requested information from the provider not received", "Send the requested records or information."],
    "227": [B.COVERAGE, "Requested information from the patient not received", "Ask the patient to contact their insurer (e.g. coordination of benefits form)."],
    "234": [B.REVIEW, "This procedure is not paid separately", "Usually write off; review if you believe it is separately payable."],
    "236": [B.FIX, "Not compatible with another procedure on the same day (NCCI edit)", "Check whether a modifier (e.g. 25, 59, XU) is supported by the note; resend."],
    "242": [B.COVERAGE, "Not provided by a network or primary care provider", "Check network status and referral requirements."],
    "243": [B.COVERAGE, "Not authorized by the network or primary care provider", "Get a referral from the primary care provider; appeal if one existed."],
    "252": [B.FIX, "Attachment or other documentation required", "Send the required documentation."],
    "253": [B.NONE, "Medicare sequestration reduction", "No action."],
    "272": [B.REVIEW, "Coverage or program guidelines not met or exceeded", "Check the payer's coverage rules for this service; appeal with records if they were met."],
    "A1": [B.REVIEW, "Claim or service denied", "Read the remark code for the reason."],
    "B7": [B.FIX, "Provider not certified or eligible for this service on this date", "Check provider enrollment/credentialing with this payer."],
    "B11": [B.COVERAGE, "Claim forwarded to the correct payer", "Follow up with the payer it was forwarded to."],
    "B15": [B.FIX, "A required qualifying service was not received", "Bill the qualifying service or correct the claim."],
  };

  var GROUPS = {
    CO: "Contractual (provider responsibility)",
    PR: "Patient responsibility",
    OA: "Other adjustment",
    PI: "Payer initiated",
    CR: "Correction or reversal",
  };

  function classify(group, code) {
    var entry = CARC[code];
    if (group === "PR") {
      if (entry && entry[0] === B.PATIENT) return { bucket: B.PATIENT, meaning: entry[1], action: entry[2] };
      return {
        bucket: B.PATIENT,
        meaning: entry ? entry[1] : "Patient responsibility (code " + code + ")",
        action: "Bill the patient if allowed. " + (entry ? entry[2] : "Check the remark code."),
      };
    }
    if (group === "CR") {
      return { bucket: B.REVIEW, meaning: "Correction or reversal" + (entry ? ": " + entry[1] : ""), action: "Check what the payer changed against the original payment." };
    }
    if (entry) return { bucket: entry[0], meaning: entry[1], action: entry[2] };
    return { bucket: B.REVIEW, meaning: "Code " + code + " (not in this guide yet)", action: "Look up the code and the remark code; add it to codes.js." };
  }

  var api = { BUCKETS: B, CARC: CARC, GROUPS: GROUPS, classify: classify };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DenialCodes = api;
})(this);
