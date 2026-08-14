# Hub documentation

Start with [`ORIENTATION.md`](ORIENTATION.md). It is the repository front door: the authoritative introduction, conceptual shape, reasons, and routing map. A reader should not need to inspect specifications to understand what the Marble is or where a concern belongs.

## Reading paths

| Need | Document |
| --- | --- |
| Understand the Hub and why it exists | [`ORIENTATION.md`](ORIENTATION.md) |
| Translate House language into clinical machinery | [`GLOSSARY.md`](GLOSSARY.md) |
| Determine what is implemented today | [`STATUS.md`](STATUS.md) |
| Trace material, authority, and installed crossings | [`MARBLE_CIRCULATION_MAP.md`](MARBLE_CIRCULATION_MAP.md) |
| Locate runtime responsibilities in code | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Use the constitutional design vocabulary | [`specs/HOUSE_GRAMMAR_V1.md`](specs/HOUSE_GRAMMAR_V1.md) |
| Read or change a feature's exact law | [`specs/README.md`](specs/README.md), then its named current owner |
| Understand repository engineering and lawful revision | [`engineering/BUILDERS_STANDARD.md`](engineering/BUILDERS_STANDARD.md) |
| Follow the implementation SOP | [`engineering/FEATURE_CHANGE_PROTOCOL.md`](engineering/FEATURE_CHANGE_PROTOCOL.md) |
| Inspect compatibility and migration standing | [`engineering/COMPATIBILITY_REGISTER.md`](engineering/COMPATIBILITY_REGISTER.md), [`engineering/STORE_MIGRATION_REGISTER.md`](engineering/STORE_MIGRATION_REGISTER.md) |

## Authority order

- `ORIENTATION.md` is the canonical front door and conceptual source of truth.
- `STATUS.md` is the canonical current-runtime capability register.
- Only specifications listed as current owners in [`specs/README.md`](specs/README.md) own active feature contracts.
- `HOUSE_GRAMMAR_V1.md` owns shared design vocabulary but installs nothing by naming it.
- `ORIENTATION.md`, `GLOSSARY.md`, and this index explain; they do not supersede specifications.
- `engineering/BUILDERS_STANDARD.md` governs repository change and revision procedure; it does not supersede product law.
- `PREBUILD.md` and `docs/lineage/` are ancestry, not active requirements.
- `experiments/` contains isolated propositions, not installed Hub capability.

New documents must label implemented, adopted, experimental, exploratory, and ancestral claims rather than blending them.
