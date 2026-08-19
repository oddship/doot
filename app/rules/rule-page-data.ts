import { store } from "@/lib/store";

export async function loadRulesPageData() {
  const [{ rules }, { accounts }, { folders }] = await Promise.all([
    store<any>(["rule-list"]),
    store<any>(["accounts"]),
    store<any>(["folder-cache"]),
  ]);

  return { rules, accounts, folders };
}
