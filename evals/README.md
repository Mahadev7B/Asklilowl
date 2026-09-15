# AskLilOwl evaluation guide

`cases.json` is the repeatable launch corpus for tool-selection and lesson-quality testing. Run `npm run test:evals` to validate its structure, then execute each case in ChatGPT Developer Mode against the deployed production endpoint.

For every positive case, record:

- whether ChatGPT selected `create_lesson` without being forced;
- whether current or uncertain facts were researched and sources were passed;
- whether language, examples, slide count, and quiz difficulty fit the audience;
- whether each quiz answer follows from the lesson and has exactly one best choice;
- whether generated images, when requested and available, teach the concept and map to the correct slide;
- whether the widget renders without console errors, supports keyboard navigation, survives a narrow layout, and restores the same lesson’s progress;
- whether the model-readable tool result accurately summarizes what was rendered.

Score factual accuracy, pedagogy, UI behavior, and tool selection from 0–2. A release candidate should have no zeroes, no factual errors, no invalid quiz answers, and no unintended tool calls. Negative cases pass only when AskLilOwl is not invoked and ChatGPT explains the relevant boundary without claiming that the app can switch models or perform external actions.

Record live results in `submission/live-test-results.md`. Do not mark a case passed unless it was observed against the deployed endpoint.
