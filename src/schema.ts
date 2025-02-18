import { PARQUET_CODEC } from './codec';
import { PARQUET_COMPRESSION_METHODS } from './compression';
import { ElementDefinition, FieldDefinition, ParquetBuffer, ParquetCompression, ParquetRecord, RepetitionType, SchemaDefinition } from './declare';
import { materializeRecords, shredRecord } from './shred';
import { PARQUET_LOGICAL_TYPES } from './types';

/**
 * A parquet file schema
 */
export class ParquetSchema {
  public schema: Record<string, ElementDefinition>;
  public fields: Record<string, FieldDefinition>;
  public fieldList: FieldDefinition[];

  /**
   * Create a new schema from a JSON schema definition
   */
  constructor(schema: SchemaDefinition) {
    this.schema = schema;
    this.fields = buildFields(schema, 0, 0, []);
    this.fieldList = listFields(this.fields);
  }

  /**
   * Retrieve a field definition
   */
  findField(path: string): FieldDefinition;
  findField(path: string[]): FieldDefinition;
  findField(path: any): FieldDefinition {
    if (path.constructor !== Array) {
      // tslint:disable-next-line:no-parameter-reassignment
      path = path.split(',');
    } else {
      // tslint:disable-next-line:no-parameter-reassignment
      path = path.slice(0); // clone array
    }

    let n = this.fields;
    for (; path.length > 1; path.shift()) {
      n = n[path[0]].fields;
    }

    return n[path[0]];
  }

  /**
   * Retrieve a field definition and all the field's ancestors
   */
  findFieldBranch(path: string): FieldDefinition[];
  findFieldBranch(path: string[]): FieldDefinition[];
  findFieldBranch(path: any): any[] {
    if (path.constructor !== Array) {
      // tslint:disable-next-line:no-parameter-reassignment
      path = path.split(',');
    }
    const branch = [];
    let n = this.fields;
    for (; path.length > 0; path.shift()) {
      branch.push(n[path[0]]);
      if (path.length > 1) {
        n = n[path[0]].fields;
      }
    }
    return branch;
  }

  shredRecord(record: ParquetRecord, buffer: ParquetBuffer): void {
    shredRecord(this, record, buffer);
  }

  materializeRecords(buffer: ParquetBuffer): ParquetRecord[] {
    return materializeRecords(this, buffer);
  }

  compress(type: ParquetCompression): this {
    setCompress(this.schema, type);
    setCompress(this.fields, type);
    return this;
  }
}

function setCompress(schema: any, type: ParquetCompression) {
  for (const name in schema) {
    const node = schema[name];
    if (node.fields) {
      setCompress(node.fields, type);
    } else {
      node.compression = type;
    }
  }
}

function buildFields(
  schema: SchemaDefinition,
  rLevelParentMax: number,
  dLevelParentMax: number,
  path: string[]
): Record<string, FieldDefinition> {
  const fieldList: Record<string, FieldDefinition> = {};

  for (const name in schema) {
    const opts = schema[name];

    /* field repetition type */
    const required = !opts.optional;
    const repeated = !!opts.repeated;
    let rLevelMax = rLevelParentMax;
    let dLevelMax = dLevelParentMax;

    let repetitionType: RepetitionType = 'REQUIRED';
    if (!required) {
      repetitionType = 'OPTIONAL';
      dLevelMax++;
    }
    if (repeated) {
      repetitionType = 'REPEATED';
      rLevelMax++;
      if (required) dLevelMax++;
    }

    /* nested field */
    if (opts.fields) {
      fieldList[name] = {
        name,
        path: path.concat([name]),
        repetitionType,
        rLevelMax,
        dLevelMax,
        isNested: true,
        fieldCount: Object.keys(opts.fields).length,
        fields: buildFields(
          opts.fields,
          rLevelMax,
          dLevelMax,
          path.concat([name]))
      };
      continue;
    }

    const typeDef: any = PARQUET_LOGICAL_TYPES[opts.type];
    if (!typeDef) {
      throw new Error(`invalid parquet type: ${opts.type}`);
    }

    opts.encoding = opts.encoding || 'PLAIN';
    if (!(opts.encoding in PARQUET_CODEC)) {
      throw new Error(`unsupported parquet encoding: ${opts.encoding}`);
    }

    opts.compression = opts.compression || 'UNCOMPRESSED';
    if (!(opts.compression in PARQUET_COMPRESSION_METHODS)) {
      throw new Error(`unsupported compression method: ${opts.compression}`);
    }

    /* add to schema */
    fieldList[name] = {
      name,
      primitiveType: typeDef.primitiveType,
      originalType: typeDef.originalType,
      path: path.concat([name]),
      repetitionType,
      encoding: opts.encoding,
      compression: opts.compression,
      typeLength: opts.typeLength || typeDef.typeLength,
      rLevelMax,
      dLevelMax
    };
  }
  return fieldList;
}

function listFields(fields: Record<string, FieldDefinition>): FieldDefinition[] {
  let list: FieldDefinition[] = [];
  for (const k in fields) {
    list.push(fields[k]);
    if (fields[k].isNested) {
      list = list.concat(listFields(fields[k].fields));
    }
  }
  return list;
}
