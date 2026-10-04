# Future AI capabilities

Selected ideas from the product discussions. Numbers in the first section match the original recommendations; later selections identify their discussion separately. These are future opportunities, not implementation tickets.

Product scope: image input and analysis are excluded, including nutrition-label photos, recipe screenshots, and meal-photo estimation. Nutrition input uses text and voice.

## 3. Editable “What my coach knows” memory

**Difficulty:** Medium · **Priority:** High

**User problem:** The athlete repeatedly explains the same preferences and constraints, while temporary circumstances can continue influencing advice after they stop being relevant.

The agent maintains an inspectable memory of practical context, such as:

- “My gym has no trap bar.”
- “Wednesday sessions must finish within 45 minutes.”
- “I prefer repeating breakfasts.”
- “I’m travelling until Sunday.”
- “My fencing coach wants me to focus on preparation.”

Each memory shows its source, last confirmation, and expiration when appropriate. The athlete can add, edit, or delete memories and disable memory use. Temporary circumstances expire, and inferred preferences are distinguishable from explicitly supplied facts. Memory updates should be visible in Agent logs and reversible.

**Value:** Makes recommendations more relevant without requiring repeated explanations in every conversation.

**Inspiration:** [WHOOP My Memory](https://www.whoop.com/om/en/thelocker/my-memory-whoop/).

## 6. Voice logging

**Difficulty:** Medium · **Priority:** Medium

**User problem:** Typing food descriptions and repeatedly entering familiar meals makes nutrition logging inconvenient, especially on a phone.

**Example:** “Lunch was my usual chicken and rice, but half the rice.”

The agent transcribes speech, resolves known foods, extracts quantities, and presents a reviewable draft. Let the athlete correct the transcription and ask for clarification when a meal, serving, or quantity is ambiguous. For explicitly dictated food values, distinguish per-serving values from values per 100 grams and preserve unknown values rather than inventing nutrients.

Keep saving a food separate from logging consumption. Use existing saved-food values and deterministic portion arithmetic, and require review before committing the extracted draft. Record saved changes in Agent logs with safe undo.

**Value:** Reduces repetitive entry while keeping the athlete in control of the recorded values.

## 7. Practical “What can I eat now?” assistant

**Difficulty:** Medium · **Priority:** Medium

**User problem:** Daily nutrition targets and full meal plans do not always help the athlete choose an available, convenient meal right now.

**Example:** “I’ve logged breakfast and lunch. I have eggs, rice, and yogurt, and I don’t want to cook for more than 15 minutes.”

The agent reads recorded intake, existing targets, dietary restrictions, available foods, and preparation-time constraints. It proposes two or three concrete options with quantities and explains how they fit the remaining day. Check whether the diary is reasonably complete before interpreting an apparent shortfall.

Use deterministic calculations for nutrient totals and clearly distinguish saved food values from estimates. Dietary exclusions remain hard constraints. The athlete can save an option as a reusable meal template or log it after confirming that they ate it; suggestions alone never count as consumption.

Build on the dietary-constraint and repeat-meal workflows, with changes recorded in Agent logs and reversible where supported.

**Value:** Turns nutrition guidance into a practical decision at the moment the athlete is choosing food.

## 8. Turn a recipe into a reusable meal

Selected as idea 1 from the second set of recommendations.

**Difficulty:** Medium · **Priority:** High

**User problem:** Homemade meals require repeatedly entering ingredients or requesting new estimates, even when the athlete cooks the same recipe regularly.

**Example:** “Here’s my pasta recipe. I used these ingredients and divided it into four portions. Save it.”

Accept a pasted recipe or a text description of what was cooked. The agent identifies ingredients, matches saved products when possible, asks about missing quantities and raw-versus-cooked measurements, and drafts a reusable recipe with nutrition per portion. Nutrient arithmetic is deterministic, and estimated ingredient values remain distinguishable from supplied product values.

The athlete reviews ingredient matches, quantities, and the number of portions before saving. Later, “Log one portion of yesterday’s pasta” records a portion using the saved recipe values. Support partial portions and preserve unknown nutrient values.

Keep saving a recipe separate from logging consumption. Version or snapshot recipe values so later edits do not alter historical meal logs. Record agent-created recipes and logged portions in Agent logs, with safe undo where supported.

**Value:** Makes homemade meals as convenient to log as packaged foods while reducing repeated estimation and data entry.

**Inspiration:** [MacroFactor recipe import](https://help.macrofactorapp.com/en/articles/398-import-recipes-with-ai).
