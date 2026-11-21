# Fees acceptance tests – BNM Public School

For the accounts team, before the new system replaces SchoolElement on **1 April 2027**.
Work through each test, compare with what SchoolElement would do, and mark **Pass** or **Fail** with a note.
Anything marked Fail goes back to the developers with the test number.

**Before you start**
- Use the test system you were given (not the live one). Its data is made up; feel free to change it.
- Sign in as **Accounts** (Kavitha) unless the test says otherwise. Parents sign in on the **Parent** tab with their mobile number and the code sent to it.
- Amounts in the test system are placeholders until the school confirms the 2027-28 fee chart.

| # | Area | Steps | Expected result | Pass / Fail | Notes |
|---|---|---|---|---|---|
| **A** | **Fee setup and invoices** | | | | |
| A1 | Fee chart | Fees → Fee setup. Open School Fees, check class bands (G1–G4 … G11–G12) and the rate for each admission type. | Bands and rates match the school's fee chart. 4 installments due 5 Apr / 5 Jul / 5 Oct / 5 Jan. | | |
| A2 | Assign | Fees → Assign & publish. Pick School Fees and a class. Tick all, **Assign**. | Each student gets the fee for their band and admission type. Students without a matching rate are listed with the reason. | | |
| A3 | Confirm and publish | Same screen: **Confirm**, then **Publish to parents**, then **Online on**. | Status moves Assigned → Confirmed → Published → Online. Sign in as the parent: the fee is visible under Fees. | | |
| A4 | Transport | Set a student's transport slab and pickup mode (student profile → Edit fee profile). Assign Transportation Fees. | Price matches the slab and pickup mode. 2 installments. | | |
| **B** | **Counter collection** | | | | |
| B1 | Full payment | Fees → Collect. Find a student, tick the oldest installment, Cash, **Collect**. | Receipt number `BNMPS/2026-27/nnnn` (next in series). Print shows amount in words. Parent gets an SMS. | | |
| B2 | Part payment | Collect ₹10,000 of an installment. | Receipt for ₹10,000; the balance stays on that installment. | | |
| B3 | Late fee | Collect an installment that is past its due date with **Collect** chosen for the late fee. | Late fee = ₹25 × days late, shown on the receipt in its own column. | | |
| B4 | Waive late fee at collection | Same, choose **Waive** and give a reason. | No late fee on the receipt; the waiver and reason appear on the receipt and in Reports → Concessions & refunds. | | |
| B5 | Cheque | Collect by Cheque without bank / number / date, then with a cheque dated tomorrow, then with today's date. | First two are refused with a clear message. Third gives a receipt marked "Awaiting bank". | | |
| B6 | Cheque cleared / bounced | Open the cheque receipt: **Money received** on one, **Bounced** on another. | Cleared one shows Reconciled. Bounced one is cancelled and the balance is back on the installment. | | |
| B7 | Cancel a receipt | Open a receipt → **Cancel receipt** with a reason. | Receipt shows CANCELLED with the reason; the amount is back on the installment; it still appears (struck through) in the register. | | |
| B8 | Day's register | Fees → Receipts for today. | Every receipt of the day with totals by mode. Matches the cash and cheques in hand. | | |
| **C** | **Corrections** | | | | |
| C1 | Concession by amount | Student profile → fee → **Concession**: ₹5,000, Equally, reason "Sibling in the school". | Spread over unpaid installments only. Shown in the student's history with your name and date. | | |
| C2 | Concession by % | Same, 10% of the annual fee, Order wise. | Replaces the earlier concession; fills the first unpaid installment first. | | |
| C3 | Write off | A student who left: **Write off** the unpaid amount with "T C taken". | Remark reads "The total adjustment amount ₹X out of a total amount of ₹Y (T C taken)". Balance becomes 0. | | |
| C4 | Refund | Open a paid receipt → **Refund…** ₹12,500 by Cheque with the cheque number. Then refund the rest. | Both refunds listed on the receipt; refundable amount goes to 0; the receipt can no longer be cancelled. | | |
| C5 | Waive late fee only | On an overdue installment click **Waive** next to the late fee. | Late fee becomes 0 today and starts again tomorrow if still unpaid. | | |
| **D** | **Online payments** (sign in as a parent) | | | | |
| D1 | Pay online | Parent → Fees → **Pay online** → pay. | Receipt issued straight away with source Online; SMS to the parent; appears under Fees → Online payments for accounts. | | |
| D2 | Declined | Same, choose "Bank declines". | "No money was taken"; no receipt; attempt listed as Failed with code 1072. | | |
| D3 | Bank pending | Choose "Bank is slow". Try to pay again. | Second payment refused until the first completes. | | |
| **E** | **Reports** | | | | |
| E1 | Dues | Fees → Reports → Dues. | Overdue students with parent name and mobile; totals match the class summary's overdue. CSV downloads. | | |
| E2 | Reminders | **Send SMS reminders**, then press it again. | First sends one SMS per overdue student; the second sends none (once a day). | | |
| E3 | Class summary | Reports → Class summary. | Billed, concession, written off, collected, refunded, balance and % per class; matches SchoolElement's class-level summary for the same data. | | |
| E4 | Concessions & refunds | Reports → Concessions & refunds for this month. | All concessions, write-offs, waivers, refunds and cancelled receipts, each with who and when. | | |
| **F** | **Moving data from SchoolElement** | | | | |
| F1 | Students | Sign in as the Branch Manager. Students → Import CSV. Upload SchoolElement's student export as it is (sample: `docs/samples/schoolelement-students.csv`). | Check lists any problem rows; "Enrollment No" is reported as not used. After import: classes, both parents, RTE and admission type are right; brothers/sisters sharing a parent mobile are linked. | | |
| F2 | Previous-year balances | Fees → Reports → *Import previous-year balances* (sample: `docs/samples/schoolelement-previous-balances.csv`). | Each student gets a "Previous year balance" fee, confirmed, with **no late fee**. Importing the same file again is refused for those students. | | |
| F3 | Totals check | After F1–F2, compare SchoolElement's Previous Balance report total with Reports → Dues (untick Overdue only). | Totals agree. | | |

## Running both systems side by side (sprint 8, 8–19 March)

1. Keep collecting in SchoolElement as today. Enter the same payments in the new system (Collect), same day.
2. Each evening: in SchoolElement run **Daily Transaction** for the day and export CSV. In the new system open **Fees → Reports → Parallel run** and upload it (sample: `docs/samples/schoolelement-daily-transactions-2026-07-05.csv`).
3. Every row should read **Same**. For anything else:
   - *Different amount*: one system has a wrong amount or a missing late fee. Correct the wrong one (cancel and re-issue).
   - *Only in SchoolElement*: the payment was not entered here. Collect it.
   - *Only here*: entered here by mistake, or missing in SchoolElement.
4. Two clean days in a row with no differences = ready to switch.

## Cut-over checklist (week of 22 March)

- [ ] 2027-28 fee chart confirmed by the school and entered; "Amounts confirmed" ticked on every fee type.
- [ ] Final SchoolElement exports taken on the last day: students, Previous Balance, Daily Transaction.
- [ ] Students imported for every branch (F1) and checked against SchoolElement's student count per class.
- [ ] Previous-year balances imported (F2); totals match (F3).
- [ ] 2027-28 fees assigned, confirmed and published (A2–A3) before 5 April.
- [ ] Payment gateway and SMS provider live (test payments of ₹1 refunded).
- [ ] Accounts and branch managers trained; parents told how to sign in and pay.
