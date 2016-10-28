export let random: (max: number) => number = (max: number) => Math.floor(Math.random() * max);

export function setRandom(value: (max: number) => number): void {
	random = value;
}

interface Action {
	(message: any, instance: IInstance, deepHistory: boolean): void;
}

/*
function push(to: Array<Action>, ...actions: Array<Array<Action>>): void {
	for (const set of actions) {
		for (const action of set) {
			to.push(action);
		}
	}
}
*/

function invoke(actions: Array<Action>, message: any, instance: IInstance, deepHistory: boolean): void {
	for (const action of actions) {
		action(message, instance, deepHistory);
	}
}

export interface Behavior {
	(message: any, instance: IInstance): void;
}

export interface Guard {
	(message: any, instance: IInstance): boolean;
}

export enum PseudoStateKind {
	Choice,
	DeepHistory,
	Initial,
	Junction,
	ShallowHistory
}

export enum TransitionKind {
	External,
	Internal,
	Local
}

export interface Element {
	getAncestors(): Array<Element>;
	getRoot(): StateMachine;
	isActive(instance: IInstance): boolean;
	toString(): string;
}

export abstract class NamedElement<TParent extends Element> implements Element {
	static namespaceSeparator = ".";
	readonly qualifiedName: string;

	protected constructor(public readonly name: string, public readonly parent: TParent) {
		this.qualifiedName = parent ? parent.toString() + NamedElement.namespaceSeparator + name : name;

		console.log("created " + this);
	}

	getAncestors(): Array<Element> {
		return this.parent.getAncestors().concat(this);
	}

	getRoot(): StateMachine {
		return this.parent.getRoot();
	}

	isActive(instance: IInstance): boolean {
		return this.parent.isActive(instance);
	}

	accept<TArg>(visitor: Visitor<TArg>, arg?: TArg) {
		visitor.visitElement(this, arg);
	}

	toString(): string {
		return this.qualifiedName;
	}
}

export class Region extends NamedElement<State | StateMachine> {
	static defaultName = "default";

	readonly vertices = new Array<Vertex>();

	constructor(name: string, parent: State | StateMachine) {
		super(name, parent);

		this.parent.regions.push(this);
		this.getRoot().clean = false;
	}

	isComplete(instance: IInstance): boolean {
		const currentState = instance.getCurrent(this);

		return currentState !== undefined && currentState.isFinal();
	}

	accept<TArg>(visitor: Visitor<TArg>, arg?: TArg) {
		visitor.visitRegion(this, arg);
	}
}

export class Vertex extends NamedElement<Region> {
	readonly outgoing = new Array<Transition>();
	readonly incoming = new Array<Transition>();

	constructor(name: string, parent: Region | State | StateMachine) {
		super(name, parent instanceof Region ? parent : parent.getDefaultRegion());

		this.parent.vertices.push(this);
		this.getRoot().clean = false;
	}

	to(target?: Vertex, kind: TransitionKind = TransitionKind.External): Transition {
		return new Transition(this, target, kind);
	}

	accept<TArg>(visitor: Visitor<TArg>, arg?: TArg) {
		visitor.visitVertex(this, arg);
	}
}

export class PseudoState extends Vertex {
	constructor(name: string, parent: Region | State | StateMachine, public readonly kind: PseudoStateKind = PseudoStateKind.Initial) {
		super(name, parent);
	}

	isHistory(): boolean {
		return this.kind === PseudoStateKind.DeepHistory || this.kind === PseudoStateKind.ShallowHistory;
	}

	isInitial(): boolean {
		return this.kind === PseudoStateKind.Initial || this.isHistory();
	}

	accept<TArg>(visitor: Visitor<TArg>, arg?: TArg) {
		visitor.visitPseudoState(this, arg);
	}
}

export class State extends Vertex {
	readonly regions = new Array<Region>();
	defaultRegion: Region;
	entryBehavior = new Array<Behavior>();
	exitBehavior = new Array<Behavior>();


	constructor(name: string, parent: Region | State | StateMachine) {
		super(name, parent);
	}

	getDefaultRegion(): Region {
		return this.defaultRegion || (this.defaultRegion = new Region(Region.defaultName, this));
	}

	isFinal(): boolean {
		return this.outgoing.length === 0;
	}

	isSimple(): boolean {
		return this.regions.length === 0;
	}

	isComposite(): boolean {
		return this.regions.length > 0;
	}

	isOrthogonal(): boolean {
		return this.regions.length > 1;
	}

	exit(action: Behavior) {
		this.exitBehavior.push(action);

		this.getRoot().clean = false;

		return this;
	}

	enter(action: Behavior) {
		this.exitBehavior.push(action);

		this.getRoot().clean = false;

		return this;
	}

	isActive(instance: IInstance): boolean {
		return super.isActive(instance) && instance.getCurrent(this.parent) === this;
	}

	isComplete(instance: IInstance): boolean {
		return this.regions.every(region => region.isComplete(instance));
	}

	accept<TArg>(visitor: Visitor<TArg>, arg?: TArg) {
		visitor.visitState(this, arg);
	}
}

export class StateMachine implements Element {
	readonly regions = new Array<Region>();
	defaultRegion: Region | undefined = undefined;
	clean: boolean = false;
	private onInitialise = new Array<Action>();

	constructor(public readonly name: string) {
	}

	getDefaultRegion(): Region {
		return this.defaultRegion || (this.defaultRegion = new Region(Region.defaultName, this));
	}

	getAncestors(): Array<Element> {
		return [this];
	}

	getRoot(): StateMachine {
		return this;
	}

	accept<TArg>(visitor: Visitor<TArg>, arg?: TArg) {
		visitor.visitStateMachine(this, arg);
	}

	isActive(instance: IInstance): boolean {
		return true;
	}

	isComplete(instance: IInstance): boolean {
		return this.regions.every(region => region.isComplete(instance));
	}

	initialise(instance?: IInstance, autoInitialiseModel: boolean = true): void {
		if (instance) {
			if (autoInitialiseModel && this.clean === false) {
				this.initialise();
			}

			console.log(`initialise ${instance}`);

			invoke(this.onInitialise, undefined, instance, false);
		} else {
			console.log(`initialise ${this}`);

			this.accept(new InitialiseStateMachine());

			// TODO: accept initialier
			this.clean = true;
		}
	}

	toString(): string {
		return this.name;
	}
}

export class Transition {
	guard: Guard;
	effectBehavior = new Array<Behavior>();
	// private onTraverse = new Array<Action>();

	constructor(public readonly source: Vertex, public readonly target?: Vertex, public readonly kind: TransitionKind = TransitionKind.External) {
		this.guard = source instanceof PseudoState ? () => true : message => message === this.source;
		this.source.outgoing.push(this);
		this.source.getRoot().clean = false;

		if (this.target) {
			this.target.incoming.push(this);
		}
		else {
			this.kind = TransitionKind.Internal;
		}

		console.log("created transition from " + source + " to " + target);
	}

	else() { // NOTE: no need to invalidate the machine as the transition actions have not changed.
		this.guard = () => false;

		return this;
	}

	when(guard: Guard) { // NOTE: no need to invalidate the machine as the transition actions have not changed.
		this.guard = guard;

		return this;
	}

	effect(action: Behavior) {
		this.effectBehavior.push(action);

		this.source.getRoot().clean = false;

		return this;
	}

	accept<TArg>(visitor: Visitor<TArg>, arg?: TArg) {
		visitor.visitTransition(this, arg);
	}

	toString(): string {
		return TransitionKind[this.kind] + "(" + (this.kind === TransitionKind.Internal ? this.source : (this.source + " -> " + this.target)) + ")";
	}
}

export class Visitor<TArg> {
	visitElement(element: Element, arg?: TArg): void {
		console.log("visiting " + element.toString());
	}

	visitRegion(region: Region, arg?: TArg): void {
		for (const vertex of region.vertices) {
			vertex.accept(this, arg);
		}

		this.visitElement(region, arg);
	}

	visitVertex(vertex: Vertex, arg?: TArg): void {
		for (const transition of vertex.outgoing) {
			transition.accept(this, arg);
		}

		this.visitElement(vertex, arg);
	}

	visitPseudoState(pseudoState: PseudoState, arg?: TArg): void {
		this.visitVertex(pseudoState, arg);
	}

	visitState(state: State, arg?: TArg): void {
		for (const region of state.regions) {
			region.accept(this, arg);
		}

		this.visitVertex(state, arg);
	}

	visitStateMachine(stateMachine: StateMachine, arg?: TArg): void {
		for (const region of stateMachine.regions) {
			region.accept(this, arg);
		}

		this.visitElement(stateMachine, arg);
	}

	visitTransition(transition: Transition, arg?: TArg): void {
		console.log("visiting " + transition);
	}
}

export interface IInstance {
	setCurrent(region: Region, state: State): void;

	getCurrent(region: Region): State | undefined;
}

export class DictionaryInstance implements IInstance {
	readonly activeStateConfiguration: { [id: string]: State } = {};

	constructor(public readonly name: string) { }

	setCurrent(region: Region, state: State): void {
		this.activeStateConfiguration[region.qualifiedName] = state;
	}

	getCurrent(region: Region): State | undefined {
		return this.activeStateConfiguration[region.qualifiedName];
	}

	toString(): string {
		return this.name;
	}
}

class InitialiseStateMachine extends Visitor<boolean> {

}