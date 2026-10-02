// Verify the onboarding profile-completion detection logic.
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("PASS:", msg); };

// Mirror of the detection used in /api/onboarding/status.
function profileDone(userDoc) {
  return Boolean(
    userDoc?.companyName?.trim() ||
    userDoc?.phone?.trim() ||
    (userDoc?.address && Object.values(userDoc.address).some((v) => v && String(v).trim()))
  );
}

assert(profileDone(null) === false, "no user doc -> not done");
assert(profileDone({}) === false, "empty doc -> not done");
assert(profileDone({ companyName: "  " }) === false, "whitespace-only company -> not done");
assert(profileDone({ companyName: "Acme Sdn Bhd" }) === true, "company name set -> done");
assert(profileDone({ phone: "012-3456789" }) === true, "phone set -> done");
assert(profileDone({ address: {} }) === false, "empty address object -> not done");
assert(profileDone({ address: { line1: "", city: "  " } }) === false, "blank address fields -> not done");
assert(profileDone({ address: { city: "Kuala Lumpur" } }) === true, "one address field set -> done");
assert(profileDone({ address: { postcode: "50000" } }) === true, "postcode set -> done");

// Checklist visibility logic.
function visible(status, hiddenLocal) {
  if (!status || hiddenLocal || status.dismissed) return false;
  if (status.doneCount >= status.total) return false;
  return true;
}
assert(visible(null, false) === false, "not loaded -> hidden");
assert(visible({ dismissed: true, doneCount: 0, total: 5 }, false) === false, "dismissed -> hidden");
assert(visible({ dismissed: false, doneCount: 5, total: 5 }, false) === false, "all done -> hidden");
assert(visible({ dismissed: false, doneCount: 2, total: 5 }, false) === true, "in progress -> visible");
assert(visible({ dismissed: false, doneCount: 2, total: 5 }, true) === false, "locally hidden -> hidden");

console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
