export interface Type {
    name: string;
    links?: Link[];
}

export interface Link {
    category: Category;
    recordName: string;
    libraryName?: string;
}

export type Category = "internal" | "external";

export interface Parameter {
    name: string;
    description: string;
    type: Type;
    default?: string;
}

export interface Return {
    description?: string;
    type: Type;
}

export interface EnumValue {
    name: string;
    description: string;
}

export interface Field {
    name: string;
    description: string;
    type: Type;
    default?: string;
}

export interface UnionValue {
    name: string;
    type: Type;
}

export interface PathParameter {
    name: string;
    type: string;
}

export interface TypeDefinitionBase {
    name: string;
    description: string;
    type: string;
}

export interface ConstantTypeDefinition extends TypeDefinitionBase {
    value: string;
    varType: Type;
}

export interface RecordTypeDefinition extends TypeDefinitionBase {
    fields: Field[];
}

export interface EnumTypeDefinition extends TypeDefinitionBase {
    members: EnumValue[];
}

export interface UnionTypeDefinition extends TypeDefinitionBase {
    members: UnionValue[];
}

export interface ClassTypeDefinition extends TypeDefinitionBase {
    functions: any[];
}

export type TypeDefinition =
    | RecordTypeDefinition
    | EnumTypeDefinition
    | UnionTypeDefinition
    | ClassTypeDefinition
    | TypeDefinitionBase
    | ConstantTypeDefinition;

export interface AbstractFunction {
    type: string;
    description: string;
    parameters: Parameter[];
    return: Return;
}

export interface ResourceFunction extends AbstractFunction {
    accessor: string;
    paths: (PathParameter | string)[];
}

export interface RemoteFunction extends AbstractFunction {
    name: string;
}

export interface Client {
    name: string;
    description: string;
    functions: (RemoteFunction | ResourceFunction)[];
}

export interface Listener {
    name: string;
    parameters: Parameter[];
}

export interface Service {
    listener: Listener;
    type: "generic" | "fixed";
}

export interface Library {
    name: string;
    description: string;
    typeDefs: TypeDefinition[];
    clients: Client[];
    functions?: RemoteFunction[];
    services?: Service[];
}