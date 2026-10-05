"use client";
import {
  Archive,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FolderInput,
  ImageIcon,
  LoaderCircle,
  MailOpen,
  Paperclip,
  Reply,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmailFrame } from "@/components/email-frame";
import { useToast } from "@/components/feedback";
import { LocalTime } from "@/components/local-time";
import { Badge, Button, Dialog, Input, Label, Skeleton, Tabs, Tooltip } from "@/components/ui";
import { saveAgentHandoff } from "@/lib/client-agent-handoff";
import { apiJson, errorMessage } from "@/lib/client-api";
import { LatestRequest } from "@/lib/client-latest-request";
import { reuseMailRows } from "@/lib/client-mail-rows";
import { navigateClient, replaceClientUrl } from "@/lib/client-navigation";
import { saveSelectedSearch } from "@/lib/client-search-selection";
import { loadSelectedIds, saveSelectedIds, selectedMessageId, selectedMessageRef } from "@/lib/client-selection";
import { paginationItems } from "@/lib/pagination";
import { useCacheEvents } from "@/lib/use-cache-events";

type Mail = {
  account: string;
  account_email: string;
  uid: string;
  folder: string;
  sender: string;
  subject: string;
  date: string;
  body_fetched?: number;
  unread?: number;
};
const MailRow = memo(function MailRow({
  mail,
  active,
  selected,
  onOpen,
  onToggle,
}: {
  mail: Mail;
  active: boolean;
  selected: boolean;
  onOpen: (mail: Mail) => void;
  onToggle: (mail: Mail) => void;
}) {
  return (
    <div className={`mail-item ${active ? "active" : ""}`} onClick={() => onOpen(mail)}>
      <input
        type="checkbox"
        aria-label={`Select ${mail.subject}`}
        checked={selected}
        onChange={() => onToggle(mail)}
        onClick={(event) => event.stopPropagation()}
      />
      <div>
        <strong>{mail.sender}</strong>
        <div className="subject">{mail.subject || "(no subject)"}</div>
        <small>
          {mail.account_email} · {mail.folder}
          {mail.body_fetched ? " · cached body" : ""}
        </small>
      </div>
      <small>{mail.date ? <LocalTime value={mail.date} /> : ""}</small>
    </div>
  );
});

type MoveFolder = { path: string; flags?: string[]; rule_target_allowed?: boolean };
type MoveChoice = { account: string; provider: "gmail" | "imap"; folders: MoveFolder[]; target: string };
export function InboxClient({
  accounts,
  initial,
  initialAccount = "all",
  initialQuery = "",
  initialOpenUid,
  initialOpenFolder,
  initialLimit = 25,
}: {
  accounts: any[];
  initial: any;
  initialAccount?: string;
  initialQuery?: string;
  initialOpenUid?: string;
  initialOpenFolder?: string;
  initialLimit?: number;
}) {
  const toast = useToast();
  const [account, setAccount] = useState(initialAccount);
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [searchLoading, setSearchLoading] = useState(false);
  const searches = useRef(new LatestRequest());
  const bodies = useRef(new LatestRequest());
  const searchBusy = useRef(false);
  const refreshPending = useRef(false);
  const reader = useRef<Mail | null>(null);
  useEffect(
    () => () => {
      searches.current.cancel();
      bodies.current.cancel();
    },
    [],
  );
  const [offset, setOffset] = useState(initial.offset || 0);
  const [pageSize, setPageSize] = useState(initialLimit);
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<Mail | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<any>(null);
  const [applyingProposal, setApplyingProposal] = useState(false);
  const [moveChoice, setMoveChoice] = useState<MoveChoice | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [renderMode, setRenderMode] = useState("Message");
  useEffect(() => {
    const refresh = () => setSelected(loadSelectedIds());
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  const updateSelected = useCallback((update: (current: string[]) => string[]) => {
    setSelected((current) => {
      const next = update(current);
      saveSelectedIds(next);
      return loadSelectedIds();
    });
  }, []);
  const updateUrl = useCallback(
    (
      nextAccount: string,
      nextQuery: string,
      openUid?: string,
      nextOffset = offset,
      nextLimit = pageSize,
      openFolder?: string,
    ) => {
      const params = new URLSearchParams();
      if (nextAccount !== "all") params.set("account", nextAccount);
      if (nextQuery) params.set("query", nextQuery);
      if (openUid) params.set("open", openUid);
      if (openUid && openFolder) params.set("folder", openFolder);
      const page = Math.floor(nextOffset / nextLimit) + 1;
      if (page > 1) params.set("page", String(page));
      if (nextLimit !== 25) params.set("limit", String(nextLimit));
      replaceClientUrl(`/inbox${params.size ? `?${params}` : ""}`);
    },
    [offset, pageSize],
  );
  const load = async (
    nextOffset = offset,
    nextAccount = account,
    nextQuery = activeQuery,
    nextLimit = pageSize,
    openUid?: string,
    openFolder?: string,
  ): Promise<void> => {
    const request = searches.current.begin();
    searchBusy.current = true;
    setSearchLoading(true);
    try {
      let value: any;
      do {
        value = await apiJson(
          `/api/messages?account=${encodeURIComponent(nextAccount)}&query=${encodeURIComponent(nextQuery)}&offset=${nextOffset}&limit=${nextLimit}${openFolder ? `&focus_folder=${encodeURIComponent(openFolder)}` : ""}`,
          { signal: request.signal },
          "Inbox search failed",
        );
        if (!request.current()) return;
        if (nextOffset === 0 || nextOffset < value.total) break;
        nextOffset = Math.max(0, Math.floor(Math.max(0, value.total - 1) / nextLimit) * nextLimit);
      } while (request.current());
      if (!request.current()) return;
      setData((previous: any) => ({ ...value, messages: reuseMailRows(previous.messages, value.messages) }));
      setOffset(nextOffset);
      setActiveQuery(nextQuery);
      openUid = reader.current?.uid;
      openFolder = reader.current?.folder;
      updateUrl(nextAccount, nextQuery, openUid, nextOffset, nextLimit, openFolder);
    } catch (error) {
      if (request.current()) toast.error(errorMessage(error, "Inbox search failed"));
    } finally {
      if (request.current()) {
        searchBusy.current = false;
        setSearchLoading(false);
        if (refreshPending.current) {
          refreshPending.current = false;
          void load(nextOffset, nextAccount, nextQuery, nextLimit, reader.current?.uid, reader.current?.folder);
        }
      }
    }
  };
  useCacheEvents((value) => {
    if (value.type !== "cache.refresh" || value.resource !== "messages") return;
    const affected = new Set(
      (Array.isArray(value.items) ? value.items : [])
        .filter((item: any) => item.cache_hidden !== false)
        .map((item: any) =>
          selectedMessageId({ account: item.account, uid: String(item.uid), folder: item.source_folder }),
        ),
    );
    if (affected.size) updateSelected((current) => current.filter((id) => !affected.has(id)));
    const removedOpen = Boolean(open && affected.has(selectedMessageId(open)));
    if (removedOpen) {
      reader.current = null;
      bodies.current.cancel();
      setLoading(false);
      setOpen(null);
      setDetail(null);
    }
    if (searchBusy.current) {
      refreshPending.current = true;
      return;
    }
    void load(offset, account, activeQuery, pageSize, removedOpen ? undefined : open?.uid, open?.folder);
  });
  const fetchMessage = useCallback(async (mail: Mail, remote = false) => {
    const request = bodies.current.begin();
    setLoading(true);
    try {
      const value = await apiJson(
        `/api/message?account=${encodeURIComponent(mail.account)}&uid=${encodeURIComponent(mail.uid)}&folder=${encodeURIComponent(mail.folder)}${remote ? "&remote=1" : ""}`,
        { signal: request.signal },
        "Could not load message",
      );
      if (request.current()) setDetail(value);
    } catch (error) {
      if (request.current()) setDetail({ error: errorMessage(error, "Could not load message") });
    } finally {
      if (request.current()) setLoading(false);
    }
  }, []);
  const openMessage = useCallback(
    async (mail: Mail) => {
      reader.current = mail;
      setOpen(mail);
      setDetail(null);
      setRenderMode("Message");
      updateUrl(account, activeQuery, mail.uid, offset, pageSize, mail.folder);
      await fetchMessage(mail);
    },
    [account, activeQuery, offset, pageSize, updateUrl, fetchMessage],
  );
  useEffect(() => {
    if (!initialOpenUid) return;
    const match = initial.messages.find(
      (mail: Mail) =>
        mail.uid === initialOpenUid &&
        (!initialOpenFolder || mail.folder === initialOpenFolder) &&
        (initialAccount === "all" || mail.account === initialAccount),
    );
    if (match) void openMessage(match);
    else if (initialAccount !== "all")
      void (async () => {
        const request = bodies.current.begin();
        setLoading(true);
        try {
          const value = await apiJson<any>(
            `/api/message?account=${encodeURIComponent(initialAccount)}&uid=${encodeURIComponent(initialOpenUid)}${initialOpenFolder ? `&folder=${encodeURIComponent(initialOpenFolder)}` : ""}`,
            { signal: request.signal },
            "Could not load message",
          );
          if (!request.current()) return;
          reader.current = value;
          setOpen(value);
          setDetail(value);
          setRenderMode("Message");
        } catch (error) {
          if (request.current()) {
            setDetail({ error: errorMessage(error, "Could not load message") });
            updateUrl(initialAccount, initialQuery);
          }
        } finally {
          if (request.current()) setLoading(false);
        }
      })();
  }, []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(".mail-item.active")?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open?.account, open?.folder, open?.uid]);
  const toggle = useCallback(
    (mail: Mail) => {
      const id = selectedMessageId(mail);
      updateSelected((old) => (old.includes(id) ? old.filter((value) => value !== id) : [...old, id]));
    },
    [updateSelected],
  );
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const openedId = open ? selectedMessageId(open) : "";
  const openedSelected = Boolean(openedId && selected.includes(openedId));
  const draftReply = () => {
    if (!open) return;
    if (!openedSelected) updateSelected((current) => [...new Set([openedId, ...current])]);
    const topic = open.subject ? `“${open.subject}”` : "their message";
    saveAgentHandoff({
      prompt: `Draft a reply to ${senderName} about ${topic}. Read the selected email for context, then prepare a local draft for review.`,
    });
    navigateClient("/");
  };
  const refineSearchWithDoot = () => {
    const currentQuery = activeQuery.trim();
    if (!currentQuery) return;
    saveSelectedSearch({ account, query: currentQuery });
    saveAgentHandoff({
      prompt: `Refine this inbox search: ${currentQuery}`,
    });
    navigateClient("/");
  };
  const pageIds = (data.messages || []).map((mail: Mail) => selectedMessageId(mail));
  const pageSelected = pageIds.length > 0 && pageIds.every((id: string) => selectedIds.has(id));
  const togglePage = () => {
    updateSelected((old) => {
      if (pageSelected) return old.filter((id) => !pageIds.includes(id));
      return [...new Set([...old, ...pageIds])];
    });
  };
  const createManualProposal = async (
    action: "archive" | "move" | "delete",
    messageIds: string[],
    folder?: string,
    reason = "Manually selected in Inbox",
  ) => {
    const items = messageIds.flatMap((id) => {
      const reference = selectedMessageRef(id);
      return reference ? [{ ...reference, source_folder: reference.folder, ...(folder ? { folder } : {}) }] : [];
    });
    try {
      const value = await apiJson(
        "/api/manual-proposals",
        {
          method: "POST",
          json: {
            action,
            items,
            reason,
          },
        },
        "Could not create proposal",
      );
      setProposal(value);
      if (action === "move") setMoveChoice(null);
    } catch (error) {
      toast.error("Could not create proposal", errorMessage(error, "Please try again."));
    }
  };
  const propose = (action: "archive" | "move" | "delete", folder?: string) =>
    createManualProposal(action, selected, folder);
  const prepareMove = async () => {
    const selectedAccounts = [
      ...new Set(
        selected
          .map(selectedMessageRef)
          .filter(Boolean)
          .map((reference) => reference!.account),
      ),
    ];
    if (selectedAccounts.length !== 1) {
      toast.info(
        "Choose one account",
        "Select messages from one account at a time. Folder and Gmail label paths are account-specific.",
      );
      return;
    }
    const accountName = selectedAccounts[0];
    setMoveLoading(true);
    try {
      const value = await apiJson<{ provider: "gmail" | "imap"; folders: MoveFolder[] }>(
        `/api/accounts/${encodeURIComponent(accountName)}/folders`,
        { cache: "no-store" },
        "Could not load move destinations",
      );
      const folders = value.folders.filter(
        (folder) =>
          folder.rule_target_allowed !== false && !folder.flags?.some((flag) => flag.toLowerCase() === "\\noselect"),
      );
      setMoveChoice({ account: accountName, provider: value.provider, folders, target: "" });
    } catch (error) {
      toast.error("Could not load move destinations", errorMessage(error, "Please try again."));
    } finally {
      setMoveLoading(false);
    }
  };
  const apply = async () => {
    if (!proposal || applyingProposal) return;
    setApplyingProposal(true);
    try {
      const result = await apiJson<any>(
        "/api/apply",
        { method: "POST", json: { id: proposal.id, confirm: true } },
        "Could not apply proposal",
      );
      setProposal(null);
      const appliedIds = new Set(
        (result.results || [])
          .filter((item: any) => item.cache_hidden !== false)
          .map((item: any) =>
            selectedMessageId({ account: item.account, uid: String(item.uid), folder: item.source_folder }),
          ),
      );
      updateSelected((current) => current.filter((id) => !appliedIds.has(id)));
      const removedOpen = Boolean(open && appliedIds.has(selectedMessageId(open)));
      if (removedOpen) {
        reader.current = null;
        bodies.current.cancel();
        setLoading(false);
        setOpen(null);
        setDetail(null);
      }
      await load(offset, account, activeQuery, pageSize, removedOpen ? undefined : open?.uid, open?.folder);
      if (result.status === "applied")
        toast.success("Mailbox updated", `${result.results?.length || 0} message(s) updated.`);
      else
        toast.info("Mailbox partially updated", `${appliedIds.size} succeeded; ${result.errors?.length || 0} failed.`);
    } catch (error) {
      toast.error("Could not apply proposal", errorMessage(error, "Please try again."));
    } finally {
      setApplyingProposal(false);
    }
  };
  const senderName = open?.sender?.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "") || "Message";
  const senderEmail = open?.sender?.match(/<([^>]+)>/)?.[1] || open?.sender || "";
  const initials = senderName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const pages = paginationItems(currentPage, totalPages);
  return (
    <main className="page inbox-page">
      <header className="page-head">
        <h1>Inbox</h1>
        <div className="action-list">
          <Tooltip content="Locally cached message headers">
            <Badge>{data.total} cached</Badge>
          </Tooltip>
          {data.mailbox?.messages != null && <Badge>{Number(data.mailbox.messages).toLocaleString()} in Inbox</Badge>}
          {data.mailbox?.unseen != null && <Badge>{Number(data.mailbox.unseen).toLocaleString()} unread</Badge>}
        </div>
      </header>
      <div className="inbox-layout">
        <div className="inbox-toolbar">
          <label className="inbox-toolbar-field">
            <span>Account</span>
            <select
              className="inbox-account-select"
              value={account}
              onChange={(event) => {
                const value = event.target.value;
                setAccount(value);
                reader.current = null;
                bodies.current.cancel();
                setLoading(false);
                setDetail(null);
                setOpen(null);
                void load(0, value, query);
              }}
            >
              <option value="all">All accounts</option>
              {accounts.map((item) => (
                <option value={item.name} key={item.name}>
                  {item.email}
                </option>
              ))}
            </select>
          </label>
          <form
            className="inbox-toolbar-field"
            onSubmit={(event) => {
              event.preventDefault();
              void load(0, account, query);
            }}
          >
            <span>Search cached mail</span>
            <div className="inbox-search-control">
              <Input
                aria-label="Search cached email headers"
                value={query}
                placeholder="Sender, subject, or search query"
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button className="inbox-search-submit" type="submit" size="sm" tooltip="Search cached email headers">
                {searchLoading ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
                Search
              </Button>
            </div>
          </form>
          <Button
            className="inbox-select-page"
            size="sm"
            variant="outline"
            disabled={!pageIds.length}
            aria-label={pageSelected ? "Clear visible messages" : "Select all visible messages"}
            tooltip={pageSelected ? "Unselect every visible email" : "Select every visible email"}
            onClick={togglePage}
          >
            <CheckSquare size={15} />
            {pageSelected ? "Clear page" : "Select page"}
          </Button>
        </div>
        <section className="inbox-list" aria-busy={searchLoading}>
          {activeQuery.trim() && (
            <div className="inbox-refine-search">
              <span title={activeQuery.trim()}>
                Current search: <strong>{activeQuery.trim()}</strong>
              </span>
              <Button size="sm" variant="outline" tooltip="Refine this filtered inbox" onClick={refineSearchWithDoot}>
                <Sparkles size={14} />
                Refine search with Doot
              </Button>
            </div>
          )}
          <div className="mail-scroll">
            {data.messages.map((mail: Mail) => {
              const id = selectedMessageId(mail);
              return (
                <MailRow
                  key={id}
                  mail={mail}
                  active={openedId === id}
                  selected={selectedIds.has(id)}
                  onOpen={openMessage}
                  onToggle={toggle}
                />
              );
            })}
          </div>
          <div className="pagination">
            <div className="page-buttons" aria-label="Inbox pages">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous page"
                tooltip="Open the previous page"
                disabled={currentPage === 1}
                onClick={() => load((currentPage - 2) * pageSize)}
              >
                <ChevronLeft size={14} />
              </Button>
              {pages.map((page, index) =>
                page === "ellipsis" ? (
                  <span className="page-ellipsis" key={`ellipsis-${index}`}>
                    …
                  </span>
                ) : (
                  <Button
                    key={page}
                    size="sm"
                    variant={page === currentPage ? "default" : "ghost"}
                    aria-current={page === currentPage ? "page" : undefined}
                    onClick={() => load((page - 1) * pageSize)}
                  >
                    {page}
                  </Button>
                ),
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next page"
                tooltip="Open the next page"
                disabled={currentPage === totalPages || data.total === 0}
                onClick={() => load(currentPage * pageSize)}
              >
                <ChevronRight size={14} />
              </Button>
            </div>
            <label className="page-size">
              <span>Max results</span>
              <select
                aria-label="Maximum results per page"
                value={pageSize}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setPageSize(value);
                  void load(0, account, query, value);
                }}
              >
                {[25, 50, 100].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <article className="reader-pane">
          {!open ? (
            <div className="reader-empty">
              <div>
                <MailOpen size={30} />
                <strong>No message selected</strong>
                <span>Choose a cached message to open it safely without changing its unread state.</span>
              </div>
            </div>
          ) : (
            <div className="email-document">
              <header className="email-header">
                <div className="email-account-row">
                  <Badge>{open.account_email}</Badge>
                  <Badge>{open.folder}</Badge>
                  <span>
                    <ShieldCheck size={13} /> Read without marking seen
                  </span>
                </div>
                <h1>{open.subject || "(no subject)"}</h1>
                <div className="sender-block">
                  <div className="sender-avatar">{initials}</div>
                  <div>
                    <strong>{senderName}</strong>
                    <div className="muted">
                      {senderEmail} · {open.date ? <LocalTime value={open.date} /> : ""}
                    </div>
                  </div>
                </div>
              </header>
              {loading ? (
                <div className="email-loading">
                  <Skeleton />
                  <Skeleton />
                  <Skeleton />
                </div>
              ) : detail?.error ? (
                <p>{detail.error}</p>
              ) : (
                <>
                  <div className="renderer-toolbar">
                    <Tabs tabs={["Message", "Plain text"]} value={renderMode} onChange={setRenderMode} />
                    <div className="renderer-actions">
                      <Button
                        variant={openedSelected ? "default" : "outline"}
                        size="sm"
                        tooltip={openedSelected ? "Remove from Doot context" : "Allow Doot to read body"}
                        onClick={() => toggle(open)}
                      >
                        <CheckSquare size={14} />
                        {openedSelected ? "Selected for Doot" : "Select for Doot"}
                      </Button>
                      <Button variant="outline" size="sm" tooltip="Draft reply with email context" onClick={draftReply}>
                        <Reply size={14} />
                        Draft reply with Doot
                      </Button>
                      {detail?.has_remote_images && !detail?.remote_images_allowed && (
                        <Button
                          variant="outline"
                          size="sm"
                          tooltip="Allow remote images once"
                          onClick={() => fetchMessage(open, true)}
                        >
                          <ImageIcon size={14} />
                          Load images once
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        tooltip="Prepare deletion for approval"
                        onClick={() =>
                          void createManualProposal(
                            "delete",
                            [selectedMessageId(open)],
                            undefined,
                            `Delete opened message: ${open.subject || "(no subject)"}`,
                          )
                        }
                      >
                        <Trash2 size={14} />
                        Delete message
                      </Button>
                    </div>
                  </div>
                  {detail?.has_remote_images && !detail?.remote_images_allowed && (
                    <div className="remote-banner">
                      <ShieldCheck size={15} />
                      <span>Remote images are blocked to protect your privacy.</span>
                    </div>
                  )}
                  <div className="email-body-surface">
                    {renderMode === "Message" && detail?.body_html_sanitized ? (
                      <EmailFrame html={detail.body_html_sanitized} />
                    ) : (
                      <div className="reader-content plain-content">
                        {detail?.body_text || "No readable text body."}
                      </div>
                    )}
                  </div>
                  {detail?.attachments?.length > 0 && (
                    <section className="attachment-section">
                      <h3>
                        <Paperclip size={15} /> Attachments
                      </h3>
                      <div className="attachment-grid">
                        {detail.attachments.map((item: any, index: number) => (
                          <div className="attachment-card" key={index}>
                            <Paperclip size={16} />
                            <div>
                              <strong>{typeof item === "string" ? item : item.filename || "Attachment"}</strong>
                              {typeof item === "object" && (item.content_type || item.size) && (
                                <span>
                                  {[item.content_type, item.size ? `${item.size} bytes` : ""]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </article>
      </div>
      {selected.length > 0 && (
        <div className="selection-bar">
          <strong>{selected.length} selected</strong>
          <Button
            size="sm"
            variant="outline"
            tooltip="Clear the entire selection"
            onClick={() => {
              saveSelectedIds([]);
              setSelected([]);
            }}
          >
            Unselect all
          </Button>
          <Button
            size="sm"
            variant="outline"
            tooltip="Choose a destination folder"
            disabled={moveLoading}
            onClick={() => void prepareMove()}
          >
            <FolderInput size={14} />
            {moveLoading ? "Loading…" : "Move"}
          </Button>
          <Button size="sm" variant="outline" tooltip="Prepare archive for approval" onClick={() => propose("archive")}>
            <Archive size={14} />
            Archive
          </Button>
          <Button size="sm" variant="danger" tooltip="Prepare deletion for approval" onClick={() => propose("delete")}>
            <Trash2 size={14} />
            Delete
          </Button>
        </div>
      )}
      <Dialog
        open={Boolean(moveChoice)}
        title={`Move to ${moveChoice?.provider === "gmail" ? "label" : "folder"}`}
        onClose={() => setMoveChoice(null)}
      >
        <p className="muted">
          Choose a discovered destination for {selected.length} selected message(s). The mailbox will not change until
          the next confirmation.
        </p>
        <Label htmlFor="move-target">Destination {moveChoice?.provider === "gmail" ? "label" : "folder"}</Label>
        <select
          id="move-target"
          value={moveChoice?.target || ""}
          onChange={(event) =>
            setMoveChoice((current) => (current ? { ...current, target: event.target.value } : current))
          }
        >
          <option value="">Select a destination</option>
          {moveChoice?.folders.map((folder) => (
            <option key={folder.path} value={folder.path}>
              {folder.path}
            </option>
          ))}
        </select>
        {!moveChoice?.folders.length && (
          <p className="muted">No selectable custom destinations were discovered. Create one in Settings first.</p>
        )}
        <div className="memory-dialog-actions" style={{ marginTop: 18 }}>
          <Button
            variant="outline"
            tooltip="Return without choosing destination"
            tooltipSide="top"
            onClick={() => setMoveChoice(null)}
          >
            Cancel
          </Button>
          <Button
            tooltip="Review before changing the mailbox"
            tooltipSide="top"
            disabled={!moveChoice?.target}
            onClick={() => void propose("move", moveChoice?.target)}
          >
            Continue
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(proposal)}
        title="Confirm mailbox change"
        closeDisabled={applyingProposal}
        onClose={() => {
          if (!applyingProposal) setProposal(null);
        }}
      >
        <p>
          This will apply <strong>{proposal?.action}</strong> to {proposal?.items?.length} message(s) on the upstream
          mailbox. This action requires your explicit confirmation.
        </p>
        {proposal?.action === "move" && proposal?.items?.[0]?.folder && (
          <p>
            Destination: <strong>{proposal.items[0].folder}</strong>
          </p>
        )}
        {applyingProposal && (
          <div className="mailbox-apply-status" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={15} />
            Updating the mailbox. Keep this dialog open…
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button
            variant="outline"
            tooltip={applyingProposal ? undefined : "Return without changing email"}
            tooltipSide="top"
            disabled={applyingProposal}
            onClick={() => setProposal(null)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            tooltip={applyingProposal ? undefined : "Apply this reviewed mailbox change"}
            tooltipSide="top"
            disabled={applyingProposal}
            aria-busy={applyingProposal}
            onClick={apply}
          >
            {applyingProposal && <LoaderCircle className="spin" size={14} />}
            {applyingProposal ? "Applying…" : "Confirm and apply"}
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
