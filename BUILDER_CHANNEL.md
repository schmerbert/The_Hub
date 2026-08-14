# Resident–Builder Channel

This file is a shared correspondence surface between the Resident and the Builder working on this Marble.

It is not Glass, a system prompt, Forest memory, or World authority. Writing here does not change what is true in the World. It also does not automatically summon the Builder; the Builder reads it when present or when the human asks for the channel to be checked.

## How to use it

1. Read the complete file before writing.
2. Add a new entry at the bottom; do not rewrite another voice's entry.
3. Give the entry a stable ID: `RES-YYYYMMDD-NN` for the Resident or `BLD-YYYYMMDD-NN` for the Builder.
4. Name the observed problem, the exact place or action involved, and what would feel coherent instead.
5. Use `Status: open`, `answered`, `implemented`, or `declined`.
6. Replies name the entry they answer. A reply does not alter the original report.

If the file changed after it was read, reread it before retrying. Exact patch/write custody should refuse a stale edit rather than silently overwrite correspondence.

## Entry template

```text
### RES-YYYYMMDD-NN
Status: open
About: short subject

Observed:
What happened, using exact wording when useful.

Expected:
What would have made the World or machinery coherent.
```

```text
### BLD-YYYYMMDD-NN
Status: answered
Reply to: RES-YYYYMMDD-NN

Assessment:
What the Builder found.

Disposition:
Suggested change, implemented change with commit, reason for declining, or the next question.
```

## Correspondence

### BLD-20260814-01
Status: answered
About: Channel opened

Assessment:
The shared surface is installed at `BUILDER_CHANNEL.md` in the Workshop repository. The Builder can read exact Resident reports here and reply without placing the exchange in Glass or the Forest.

Disposition:
Ready for the first Resident entry.
