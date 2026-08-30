import { scrubHostReturn } from '../scrub/host-return.js';
import { buildAmbientFeatherPreview } from './ambient-feathers.js';
import { castPolarSemanticFork } from './junction-caster.js';
import { JOURNAL_MAX_BYTES, JOURNAL_MAX_CHARS } from './store.js';
import { canonicalize, sha256 } from '../core/hash.js';

export const FOREST_WALK_TOOLS = Object.freeze([
  { type: 'function', function: { name: 'enter_forest', description: 'Deliberately visit the Resident Forest to explore a question together. From the physical Forest place, this begins at its ordinary treeline.', parameters: { type: 'object', properties: { seeking: { type: 'string', maxLength: 1000 } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'turn_around', description: 'Turn from the present into the Forest along a red-thread continuity pointer, or turn back from the Forest into the retained present place.', parameters: { type: 'object', properties: { entry_id: { type: 'string', description: 'Exact Forest entry ID when a feather or prior Forest result supplied one.' }, pointer: { type: 'string', maxLength: 1000, description: 'A remembered phrase when no exact Forest entry ID is available.' } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'walk_toward', description: 'Walk toward one exact bearing offered at the current Forest clearing.', parameters: { type: 'object', properties: { offer_id: { type: 'string' } }, required: ['offer_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_forest_leaf', description: 'Read the exact Home utterance or Journal entry reached at the current Forest clearing.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'backtrack_forest', description: 'Retrace one witnessed Forest step to the prior clearing.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'leave_forest', description: 'Leave a physical Forest visit from any clearing and return to the ordinary treeline. This does not retrace the exploratory trail.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'write_journal', description: 'Plant an exact Resident-authored entry in the Forest Home journal. This is available from any room and during a Forest walk; it does not alter conversation chronology.', parameters: { type: 'object', properties: { entry: { type: 'string', minLength: 1, maxLength: JOURNAL_MAX_CHARS } }, required: ['entry'], additionalProperties: false } } },
]);
export const FOREST_WALK_TOOL_NAMES = new Set(FOREST_WALK_TOOLS.map(tool => tool.function.name));

function invalid(code, message) { throw Object.assign(new Error(message), { code }); }
function parseArgs(call) {
  let args; try { args = JSON.parse(call?.function?.arguments || '{}'); } catch { invalid('forest_walk_invalid_argument', 'Forest walking arguments must be valid JSON.'); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('forest_walk_invalid_argument', 'Forest walking arguments must be an object.');
  return args;
}

export class ForestTraversalService {
  constructor({ store, forest, ambientFeatherService }) {
    this.store = store; this.forest = forest; this.ambient = ambientFeatherService;
  }

  projection(sessionId) { return this.store.projection(sessionId); }
  featherExclusions(sessionId) {
    const state = this.projection(sessionId);
    if (!state.active) return [];
    return [...new Set([state.currentEntryId, ...this.store.walkedEntryIds(state.journeyId), ...state.offers.map(offer => offer.entryId)].filter(Boolean))];
  }
  landFeathers({ sessionId, wakeId, generationId, rootsArtifactId, packet }) {
    return this.store.landFeathers({ sessionId, wakeId, generationId, rootsArtifactId, atoms:packet?.atoms || [] });
  }
  tools(sessionId, worldRoomId) {
    const active = this.projection(sessionId).active;
    const journal = FOREST_WALK_TOOLS.find(tool => tool.function.name === 'write_journal');
    if (active) return [...FOREST_WALK_TOOLS.filter(tool => !['enter_forest', 'write_journal'].includes(tool.function.name) && (this.projection(sessionId).entranceRegister === 'physical' || tool.function.name !== 'leave_forest')), journal];
    return [...FOREST_WALK_TOOLS.filter(tool => worldRoomId === 'place.forest' ? tool.function.name === 'enter_forest' : ['enter_forest', 'turn_around'].includes(tool.function.name)), journal];
  }
  thresholdMessage(sessionId, worldRoomId) {
    if (this.projection(sessionId).active) return null;
    if (worldRoomId === 'place.forest') return 'You stand at the ordinary Forest treeline. enter_forest begins a physical visit from here; the checked Garden path remains behind you.';
    return 'The Resident Forest can be visited without walking to the Garden. enter_forest begins a shared inquiry; turn_around follows a red thread toward continuity behind present attention. Either crossing retains this place as the exact return anchor.';
  }
  presenceMessage(sessionId) {
    const state = this.projection(sessionId);
    if (!state.active) return null;
    const footing = state.currentEntryId ? `exact Forest entry ${state.currentEntryId}` : 'the first clearing';
    const exit = state.entranceRegister === 'physical' ? 'leave_forest returns directly to the ordinary treeline.' : `The red thread turns back toward retained ${state.departurePlaceId}.`;
    return `Current place: place.forest, projecting forest.resident. Post-action Forest footing: ${footing}; ${state.stepsFromEntrance} walked steps from the entrance. This footing confirms the latest completed Forest action already present in the Scroll; it is not an independent prediction or convergence. Bearings are named by their structural or semantic role. Behind is backtrack_forest. ${exit}`;
  }
  completePhysicalReturn({ sessionId, wakeId, toolCallId, toPlaceId }) {
    const state = this.projection(sessionId);
    if (!state.active || state.entranceRegister !== 'physical' || toPlaceId !== 'place.garden') return null;
    const returned = this.store.appendSimple({ sessionId,wakeId,toolCallId:`${toolCallId}:forest_return`,kind:'returned',payload:{ returnPlaceId:'place.garden', stepsFromEntrance:state.stepsFromEntrance, returnMode:'checked_path' } });
    return { eventId: returned.eventId, journeyId: state.journeyId };
  }

  async semanticBearings(query, excludeEntryIds = [], priorAxis = null) {
    const neighborhood = await this.ambient.semanticNeighborhood({ query, excludeEntryIds, limit: 24 });
    const cast = castPolarSemanticFork({ ...neighborhood, priorAxis });
    if (!cast.offers.length) invalid('forest_walk_insufficient_terrain', 'The Forest cannot form a verified bearing from this footing.');
    return cast;
  }

  async nextBearings(entry, pathEntryIds, priorFrame, arrivalDirection) {
    const refs = this.forest.homeAtomWithChronology(entry.entryId);
    const chronological = [
      refs.chronology.predecessor ? { ...this.forest.homeAtom(refs.chronology.predecessor.entryId), direction: 'conversation_older', score: null } : null,
      refs.chronology.successor ? { ...this.forest.homeAtom(refs.chronology.successor.entryId), direction: 'conversation_newer', score: null } : null,
    ].filter(Boolean);
    const excluded = [...new Set([...pathEntryIds, entry.entryId, ...chronological.map(item => item.entryId)])];
    const semantic = await this.semanticBearings(entry.body, excluded, priorFrame?.poleAxis || null);
    const heading = arrivalDirection === 'conversation_older' ? 'older' : arrivalDirection === 'conversation_newer' || arrivalDirection === 'conversation_straight' ? (priorFrame?.chronologyHeading || 'newer') : null;
    if (heading) {
      const continuationRef = heading === 'older' ? refs.chronology.predecessor : refs.chronology.successor;
      const continuation = continuationRef ? { ...this.forest.homeAtom(continuationRef.entryId), direction:'conversation_straight', score:null } : null;
      const sides = semantic.offers.filter(item => item.direction !== 'semantic_straight');
      return { offers:[...(sides[0] ? [this.asOffer(sides[0])] : []), ...(continuation ? [this.asOffer(continuation)] : []), ...(sides[1] ? [this.asOffer(sides[1])] : [])], frame:{ arrivalKind:'chronology', chronologyHeading:heading, poleAxis:semantic.axis, receipt:semantic.receipt } };
    }
    return { offers:[...chronological, ...semantic.offers].map(item => this.asOffer(item)), frame:{ arrivalKind:'semantic', poleAxis:semantic.axis, receipt:semantic.receipt } };
  }

  asOffer(entry) {
    const preview = buildAmbientFeatherPreview(entry.body, 280).exactText;
    return { entryId: entry.entryId, sourceEventId: entry.sourceEventId, bodyHash: entry.bodyHash, score: entry.score ?? null, preview, actorKind: entry.actorKind, sourceTimestamp: entry.sourceTimestamp, direction: entry.direction || 'branch' };
  }
  visible(state) {
    const project = ({ offerId, direction, entryId, preview, actorKind, sourceTimestamp }) => ({ offerId, direction, entryId, preview, actorKind, sourceTimestamp });
    const conversationExits = state.offers.filter(offer => offer.direction.startsWith('conversation_')).map(project);
    const semanticBearings = state.offers.filter(offer => offer.direction.startsWith('semantic_') || ['branch','deeper'].includes(offer.direction)).map(project);
    return {
      kind: 'forest_walk_clearing', journeyId: state.journeyId, entranceRegister: state.entranceRegister,
      stepsFromEntrance: state.stepsFromEntrance, currentEntryId: state.currentEntryId, junctionId: state.junctionId,
      conversationExits, semanticBearings,
      backtrackAvailable: state.stepsFromEntrance > 0,
      returnAnchor: { returnPlaceId: state.departurePlaceId, returnFocusId: state.departureFocusId },
    };
  }

  async execute({ sessionId, wakeId, roomId, departureFocusId = null, tetherSourceEventId, queryFallback, intent, requestRecordId, spineRecordId, sourceEvent = null }) {
    const name = intent?.function?.name || 'unknown'; const toolCallId = intent?.id || `${wakeId}:${name}`;
    let args = {};
    try {
      if (!FOREST_WALK_TOOL_NAMES.has(name)) invalid('forest_walk_tool_unknown', 'That Forest action is not installed.');
      args = parseArgs(intent);
      let eventId; let result;
      if (name === 'write_journal') {
        if (Object.keys(args).length !== 1 || typeof args.entry !== 'string' || !args.entry.trim() || args.entry.length > JOURNAL_MAX_CHARS || Buffer.byteLength(args.entry, 'utf8') > JOURNAL_MAX_BYTES) invalid('forest_journal_invalid_argument', `entry must be nonempty and no more than ${JOURNAL_MAX_CHARS} characters (${JOURNAL_MAX_BYTES} UTF-8 bytes).`);
        if (!sourceEvent || !sourceEvent.id || sourceEvent.sessionId !== sessionId || sourceEvent.wakeId !== wakeId) invalid('forest_journal_provenance_invalid', 'Journal requires the exact current Resident tool-call Source event.');
        const provisionalActionReceiptId = `journal_${sha256(canonicalize({ sourceEventId: sourceEvent.id, toolCallId, bodyHash: sha256(args.entry) }))}`;
        const sourceLocator = { threadId: sourceEvent.threadId, sessionId: sourceEvent.sessionId, wakeId: sourceEvent.wakeId, actorKind: sourceEvent.actorKind, toolCallId, toolName:name };
        const offerId = `intake_${sha256(canonicalize({ sourceKind:'source_event', sourceId:sourceEvent.id, sourceLocator }))}`;
        const entryId = `journal_${sha256(canonicalize({ sourceEventId: sourceEvent.id, toolCallId, bodyHash: sha256(args.entry) }))}`;
        result = { ok: true, kind: 'forest_journal_entry', exact: true, entry: args.entry, bodyHash: sha256(args.entry), bucket: 'journal', jurisdiction: 'home', entryId, sourceEventId:sourceEvent.id, actionReceiptId:provisionalActionReceiptId, offerId };
        const scrub = scrubHostReturn({ toolName:name,toolCallId,arguments:args,result,roomId,actionReceiptId:provisionalActionReceiptId,requestRecordId,spineRecordId });
        this.forest.writeJournal({ sourceEvent, toolCallId, argumentsJson:intent.function.arguments, body:args.entry, requestRecordId, spineRecordId, hostReturnReceiptId:scrub.receipt.receiptId, actionReceiptId:provisionalActionReceiptId });
        eventId = provisionalActionReceiptId;
        return { name,result,scrub,actionReceipt:{ receiptId:eventId },resultRack:null,wild:[] };
      } else if (name === 'enter_forest' || (name === 'turn_around' && !this.projection(sessionId).active)) {
        if (name === 'turn_around' && roomId === 'place.forest') invalid('forest_walk_wrong_register', 'At the physical treeline, enter the Forest directly rather than turning away from it.');
        if (args.seeking !== undefined && (typeof args.seeking !== 'string' || !args.seeking.trim() || args.seeking.length > 1000)) invalid('forest_walk_invalid_argument', 'seeking must be a nonempty bounded string when supplied.');
        if (args.pointer !== undefined && (typeof args.pointer !== 'string' || !args.pointer.trim() || args.pointer.length > 1000)) invalid('forest_walk_invalid_argument', 'pointer must be a nonempty bounded string when supplied.');
        if (args.entry_id !== undefined && (typeof args.entry_id !== 'string' || !args.entry_id.trim())) invalid('forest_walk_invalid_argument', 'entry_id must be a nonempty string when supplied.');
        const entranceRegister = name === 'turn_around' ? 'recovery' : roomId === 'place.forest' ? 'physical' : 'inquiry';
        const exactPointer = args.entry_id ? this.forest.homeAtom(args.entry_id.trim()) : null;
        const query = exactPointer?.body || args.pointer?.trim() || args.seeking?.trim() || queryFallback;
        const tetherEntry = !exactPointer && tetherSourceEventId ? this.forest.homeAtomForSourceEvent(tetherSourceEventId) : null;
        const cast = await this.semanticBearings(query, tetherEntry ? [tetherEntry.entryId] : []);
        const offers = cast.offers.map(item => this.asOffer(item));
        const returnPointer = name === 'turn_around' ? exactPointer
          ? { kind:'forest_entry', entryId:exactPointer.entryId, sourceEventId:exactPointer.sourceEventId, bodyHash:exactPointer.bodyHash }
          : { kind:'remembered_phrase', pointer:args.pointer || null }
          : null;
        const entered = this.store.enter({ sessionId,wakeId,toolCallId,entranceRegister,departurePlaceId:roomId,departureFocusId:roomId === 'place.forest' ? null : departureFocusId,returnPointer,tetherSourceEventId,queryText:query,generationId:this.ambient.generationId,offers,frame:{ poleAxis:cast.axis, receipt:cast.receipt } });
        eventId = entered.eventId; result = { ok: true, ...this.visible(this.projection(sessionId)) };
      } else if (name === 'walk_toward') {
        if (typeof args.offer_id !== 'string' || !args.offer_id) invalid('forest_walk_invalid_argument', 'offer_id is required.');
        const before = this.projection(sessionId); const selected = before.offers.find(item => item.offerId === args.offer_id) || this.store.featherLanding({ sessionId,wakeId,landingId:args.offer_id });
        if (!selected) invalid('forest_walk_offer_stale', 'That bearing does not belong to the current clearing.');
        const entry = this.forest.homeAtom(selected.entryId);
        const pathIds = this.store.walkedEntryIds(before.journeyId);
        const next = await this.nextBearings(entry, pathIds, before.frame, selected.direction);
        const stepped = this.store.step({ sessionId,wakeId,toolCallId,offerId:args.offer_id,generationId:this.ambient.generationId,offers:next.offers,currentEntry:entry,frame:next.frame,selectedBearing:selected });
        eventId = stepped.eventId; result = { ok: true, arrived: { entryId: entry.entryId, actorKind: entry.actorKind, sourceTimestamp: entry.sourceTimestamp, preview: buildAmbientFeatherPreview(entry.body, 360).exactText }, ...this.visible(this.projection(sessionId)) };
      } else if (name === 'read_forest_leaf') {
        const state = this.projection(sessionId); if (!state.active || !state.currentEntryId) invalid('forest_walk_no_leaf', 'No exact Forest leaf has been reached at this clearing.');
        const entry = this.forest.homeAtom(state.currentEntryId);
        const read = this.store.appendSimple({ sessionId,wakeId,toolCallId,kind:'read',entryId:entry.entryId,payload:{ bodyHash:entry.bodyHash } });
        eventId = read.eventId; result = { ok:true, kind:'forest_leaf', exact:true, entryId:entry.entryId, sourceEventId:entry.sourceEventId, actorKind:entry.actorKind, sourceTimestamp:entry.sourceTimestamp, body:entry.body, bodyHash:entry.bodyHash };
      } else if (name === 'backtrack_forest') {
        const state = this.projection(sessionId); if (!state.active || state.stepsFromEntrance < 1) invalid('forest_walk_at_entrance', 'The walk is already at its first clearing.');
        const back = this.store.appendSimple({ sessionId,wakeId,toolCallId,kind:'backtracked',payload:{ fromJunctionId:state.junctionId } });
        eventId = back.eventId; result = { ok:true, ...this.visible(this.projection(sessionId)) };
      } else if (name === 'turn_around') {
        const state = this.projection(sessionId); if (!state.active) invalid('forest_walk_not_active', 'No Forest walk is active.');
        if (state.entranceRegister === 'physical') invalid('forest_walk_physical_return_required', 'The physical Forest visit returns through the checked Garden path.');
        const returned = this.store.appendSimple({ sessionId,wakeId,toolCallId,kind:'returned',payload:{ returnPlaceId:state.departurePlaceId, stepsFromEntrance:state.stepsFromEntrance, returnMode:'turned_back' } });
        eventId = returned.eventId; result = { ok:true, kind:'forest_walk_returned', returnPlaceId:state.departurePlaceId, journeyId:state.journeyId, walkedSteps:state.stepsFromEntrance, returnMode:'turned_back' };
      } else if (name === 'leave_forest') {
        const state = this.projection(sessionId); if (!state.active || state.entranceRegister !== 'physical') invalid('forest_walk_wrong_register', 'leave_forest belongs to a physical Forest visit.');
        const returned = this.store.appendSimple({ sessionId,wakeId,toolCallId,kind:'returned',payload:{ returnPlaceId:'place.forest', stepsFromEntrance:state.stepsFromEntrance, returnMode:'left_to_treeline' } });
        eventId = returned.eventId; result = { ok:true, kind:'forest_walk_left', returnPlaceId:'place.forest', journeyId:state.journeyId, walkedSteps:state.stepsFromEntrance, returnMode:'left_to_treeline' };
      }
      const scrub = scrubHostReturn({ toolName:name,toolCallId,arguments:args,result,roomId,actionReceiptId:eventId,requestRecordId,spineRecordId });
      return { name,result,scrub,actionReceipt:{ receiptId:eventId },resultRack:null,wild:[] };
    } catch (error) {
      const refusalId = this.store.refuse({ sessionId,wakeId,toolCallId,toolName:name,args,error });
      const result = { ok:false,kind:'forest_walk_refusal',error:error?.code || 'forest_walk_refused',message:error?.message || 'Forest walking was refused.' };
      const scrub = scrubHostReturn({ toolName:name,toolCallId,arguments:args,result,roomId,actionReceiptId:refusalId,requestRecordId,spineRecordId });
      return { name,result,scrub,actionReceipt:{ receiptId:refusalId },resultRack:null,wild:[] };
    }
  }
}
