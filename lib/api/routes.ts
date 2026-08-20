import { handleAccountRoutes } from "@/lib/api/account-routes";
import { handleAgentRoutes } from "@/lib/api/agent-routes";
import type { ApiRouteHandler } from "@/lib/api/context";
import { handleDraftRoutes } from "@/lib/api/draft-routes";
import { handleFlowRoutes } from "@/lib/api/flow-routes";
import { handleMailRoutes } from "@/lib/api/mail-routes";
import { handleScheduleRoutes } from "@/lib/api/schedule-routes";
import { handleSystemRoutes } from "@/lib/api/system-routes";
import { handleWorkspaceRoutes } from "@/lib/api/workspace-routes";

export const API_ROUTE_HANDLERS: ApiRouteHandler[] = [
  handleSystemRoutes,
  handleAccountRoutes,
  handleDraftRoutes,
  handleAgentRoutes,
  handleScheduleRoutes,
  handleFlowRoutes,
  handleMailRoutes,
  handleWorkspaceRoutes,
];
