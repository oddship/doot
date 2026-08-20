import conversation from "../fixtures/conversation.json";
import drafts from "../fixtures/drafts.json";
import flows from "../fixtures/flows.json";
import history from "../fixtures/history.json";
import message from "../fixtures/message.json";
import messages from "../fixtures/messages.json";
import settings from "../fixtures/settings.json";
import workspace from "../fixtures/workspace.json";
import { DemoClient, type DemoFixtures } from "./demo-client";

const fixtures = { conversation, drafts, flows, history, message, messages, settings, workspace } as DemoFixtures;

export default function DemoPage() {
  return <DemoClient fixtures={fixtures} />;
}
