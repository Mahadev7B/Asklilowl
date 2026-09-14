import { buildLesson } from "./lesson.js";

export const DEMO_LESSON_IDS = [
  "birds-young-learner",
  "photosynthesis-middle-school",
  "database-indexes-adult",
  "current-topic-workflow",
];

export function isDemoModeEnabled(environment = process.env) {
  return environment.ASKLILOWL_DEMO_MODE === "true";
}

const DEMO_LESSONS = {
  "birds-young-learner": {
    topic: "How do birds fly?",
    title: "How Birds Take to the Sky",
    audience: "young learner",
    depth: "quick",
    summary: "See how wings, air, feathers, and strong muscles help birds fly.",
    objectives: [
      "Name the main forces that help a bird fly.",
      "Explain how wings and feathers help a bird move through the air.",
    ],
    slides: [
      {
        id: "flight-forces",
        title: "Four forces shape every flight",
        body: "Lift pushes a bird up, gravity pulls it down, thrust moves it forward, and drag slows it. A flying bird balances all four.",
        funFact: "Birds constantly adjust their wings to stay balanced in moving air.",
        imageAlt: "A friendly diagram of a bird with arrows for lift, gravity, thrust, and drag",
        imageIndex: 0,
      },
      {
        id: "wing-shape",
        title: "Wings move the air",
        body: "A bird's curved wings guide air around them. Flapping pushes air down and backward, helping the bird rise and move forward.",
      },
      {
        id: "flight-muscles",
        title: "Strong muscles power each flap",
        body: "Large chest muscles pull the wings down. Other muscles lift the wings so the bird can flap again.",
      },
      {
        id: "feathers",
        title: "Feathers help birds steer",
        body: "Wing feathers form a smooth flight surface. Tail feathers spread, tilt, and turn to help a bird steer, slow down, and land.",
      },
    ],
    quiz: [
      {
        question: "Which feathers help a bird steer and slow down?",
        choices: ["Tail feathers", "Head feathers", "Belly feathers"],
        answerIndex: 0,
        explanation: "Tail feathers can fan out and tilt, working a little like a rudder and brake.",
      },
    ],
    sources: [],
  },
  "photosynthesis-middle-school": {
    topic: "Explain photosynthesis",
    title: "Photosynthesis: How Plants Make Food",
    audience: "middle-school learner",
    depth: "standard",
    summary: "Follow sunlight, water, and carbon dioxide as a plant turns them into sugar and oxygen.",
    objectives: [
      "Identify the ingredients and products of photosynthesis.",
      "Describe the role of chlorophyll and chloroplasts.",
    ],
    slides: [
      {
        id: "ingredients",
        title: "Plants gather three ingredients",
        body: "Leaves take in carbon dioxide, roots absorb water, and chlorophyll captures energy from sunlight.",
      },
      {
        id: "chloroplasts",
        title: "The work happens in chloroplasts",
        body: "Chloroplasts are tiny structures inside plant cells. They contain chlorophyll, the pigment that absorbs light energy.",
      },
      {
        id: "sugar",
        title: "Light energy becomes stored energy",
        body: "The plant uses light energy to rearrange water and carbon dioxide into glucose, a sugar that stores chemical energy.",
      },
      {
        id: "oxygen",
        title: "Oxygen returns to the air",
        body: "Photosynthesis also produces oxygen. Much of it leaves the leaf through tiny openings called stomata.",
        funFact: "The oxygen released during photosynthesis comes from water molecules.",
      },
    ],
    quiz: [
      {
        question: "Which pigment captures light energy for photosynthesis?",
        choices: ["Chlorophyll", "Glucose", "Oxygen", "Cellulose"],
        answerIndex: 0,
        explanation: "Chlorophyll absorbs light energy inside chloroplasts.",
      },
    ],
    sources: [],
  },
  "database-indexes-adult": {
    topic: "How does a database index work?",
    title: "Database Indexes Without the Mystery",
    audience: "adult technical learner",
    depth: "standard",
    summary: "Understand how indexes speed up reads, why they cost storage and write time, and when to use them.",
    objectives: [
      "Explain how an index narrows a database search.",
      "Recognize the main read-versus-write tradeoff of adding an index.",
    ],
    slides: [
      {
        id: "lookup-structure",
        title: "An index is a separate lookup structure",
        body: "Instead of scanning every table row, the database searches an ordered structure that maps indexed values to matching rows.",
      },
      {
        id: "btree",
        title: "B-trees keep searches shallow",
        body: "Many relational databases use balanced B-trees. Each comparison removes large sections of the search space, so lookups need relatively few steps.",
      },
      {
        id: "query-planner",
        title: "The query planner chooses whether to use it",
        body: "An index is useful only when its estimated cost beats another plan. For a query returning most rows, a sequential scan can still be faster.",
      },
      {
        id: "tradeoffs",
        title: "Faster reads have a cost",
        body: "Indexes use disk space and must be updated when indexed data changes. Too many indexes can make inserts, updates, and maintenance slower.",
      },
    ],
    quiz: [
      {
        question: "Why can adding many indexes slow down writes?",
        choices: [
          "Each relevant index must also be updated",
          "Indexes disable memory caching",
          "Every index duplicates the whole database",
        ],
        answerIndex: 0,
        explanation: "A write may need corresponding changes in every affected index.",
      },
    ],
    sources: [],
  },
  "current-topic-workflow": {
    topic: "How AskLilOwl handles a current topic",
    title: "Current Topics: Research Before Teaching",
    audience: "general learner",
    depth: "quick",
    summary: "This Inspector demo explains the workflow. It does not claim to contain live or current research.",
    objectives: [
      "Understand which part of the system researches current information.",
      "Recognize why current claims should include sources and dates.",
    ],
    slides: [
      {
        id: "question",
        title: "The user asks a time-sensitive question",
        body: "A question about today's news, markets, laws, products, or schedules needs fresh information rather than a saved demo answer.",
      },
      {
        id: "research",
        title: "ChatGPT researches and verifies",
        body: "In a real conversation, the active ChatGPT model can search appropriate sources, compare dates, and build a current explanation before calling AskLilOwl.",
      },
      {
        id: "lesson",
        title: "AskLilOwl receives a finished lesson",
        body: "The plugin receives the completed title, explanation, slides, quiz, images, and source links. It renders them; it does not choose the ChatGPT model.",
      },
      {
        id: "inspector",
        title: "Inspector only previews the interface",
        body: "MCP Inspector sends fixed test data. Use this fixture to test the UI and contract, then use ChatGPT developer mode to test real research and generation.",
      },
    ],
    quiz: [
      {
        question: "Where does fresh research happen in the production flow?",
        choices: [
          "In the active ChatGPT conversation",
          "Inside the fixed Inspector fixture",
          "Inside the AskLilOwl widget",
        ],
        answerIndex: 0,
        explanation: "The host ChatGPT model researches first and then sends the finished lesson to AskLilOwl.",
      },
    ],
    sources: [],
  },
};

export function getDemoLesson(fixtureId, { publicOrigin = "" } = {}) {
  const fixture = DEMO_LESSONS[fixtureId];
  if (!fixture) {
    throw new RangeError(`Unknown AskLilOwl demo lesson: ${fixtureId}`);
  }

  const lessonInput = structuredClone(fixture);
  if (fixtureId === "birds-young-learner") {
    const origin = publicOrigin.replace(/\/+$/, "");
    lessonInput.images = [`${origin}/test-bird.svg`];
  }

  return buildLesson(lessonInput, { isDemo: true });
}
