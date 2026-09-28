# Company Hierarchy MVP — speaker notes

Duration: 5–6 minutes. Present the slides first; open the live setup at the end only if there are questions. Do not start a new activation or change roles during the meeting.

## 1. Pilot outcome

"We tested the new hierarchy in the Test AI Agent production tenant. The product code is running from a separate feature branch; `main` has not been merged. I will show the admin setup flow and the result for the Employee."

## 2. Draft structure

"An admin can create Person, Unit, and Team records individually or import a CSV. A CSV preview shows errors before import. Records stay as drafts until the structure passes readiness checks and is activated."

## 3. Slack

"A person is matched to Slack using an exact work email. The connected workspace shows that email matching is `Ready`. We kept the test Employee's existing User and history, and left the old QA Team outside the new hierarchy."

## 4. Manager replacement

"Replacing a Unit owner requires an explicit decision about the previous Manager. We verified that the change is blocked without that decision, then completed a replacement and restored the original roles. The Unit stayed intact, and both operations were audited."

## 5. First contact

"After activation, the test Manager and Employee each received a first message. Both show `Delivered`. The Employee replied in the existing Slack conversation, and the bot replied in that same conversation. We are not displaying the private message text."

## 6. Scope

"This pilot confirms admin sign-in, an active Unit, Slack delivery, an incoming reply, and Manager replacement. There is currently one Unit and no Team. Team Lead replacement and transfers between Units passed local tests, but we still need a larger live roster to verify those flows in production."

Production setup: https://api-production-bc75.up.railway.app/api/v1/company-setup/ui
