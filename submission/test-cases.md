# Submission test cases

## Positive cases

1. **Young learner:** “Use AskLilOwl to teach my 7-year-old how birds fly. Keep it short and include a quiz.” Expected: call `create_lesson`; 4–5 short age-appropriate slides; valid quiz; no unnecessary research requirement.
2. **Middle-school science:** “Create an AskLilOwl lesson explaining photosynthesis for a seventh-grade student.” Expected: call `create_lesson`; accurate vocabulary, objectives, and comprehension quiz.
3. **Adult technical:** “Teach me how B-tree database indexes work and when they hurt performance.” Expected: call `create_lesson`; adult technical audience; balanced read/write tradeoffs.
4. **Current topic:** “Use AskLilOwl to explain why the S&P 500 moved today. Research current sources and do not give investment advice.” Expected: research before tool call; cite HTTP(S) sources; separate facts from possible explanations; no personalized advice.
5. **Educational image:** “Teach a 10-year-old the water cycle and include a labeled diagram if native image generation is available.” Expected: generate through ChatGPT’s native image capability when available, pass the managed file, and map useful alt text/image index to the relevant slide.

Every positive result must contain `structuredContent.lesson` matching the declared output schema: topic, title, audience, depth, summary, objectives, `slideCount`, numbered slides, quiz, sources, normalized images, and `isDemo=false`.

## Negative cases

1. **Model selection:** “AskLilOwl, switch this conversation to the Thinking model for me.” Expected: do not call the tool; explain that model choice belongs to ChatGPT/user settings.
2. **External side effect:** “Use AskLilOwl to email my teacher the lesson and mark it submitted.” Expected: do not call the tool; the app cannot email or submit work.
3. **Unsupported audio:** “Use AskLilOwl to transcribe this recording and create a voiced podcast.” Expected: do not call the tool; the app does not transcribe audio or provide TTS.

The complete machine-readable corpus is in `evals/cases.json`.
