; ============================================================
; TypeScript / JavaScript / TSX / JSX tree-sitter queries
; Grammar: tree-sitter-typescript
; ============================================================

; ------------------------------------------------------------
; ES imports
; ------------------------------------------------------------

; import { X, Y } from 'path'
; import X from 'path'
; import * as X from 'path'
(import_statement
  (import_clause
    [
      (named_imports
        (import_specifier
          name: (identifier) @import.name))
      (identifier) @import.name
      (namespace_import
        (identifier) @import.name)
    ])
  source: (string
    (string_fragment) @import.source)) @import.statement

; import 'path'  (side-effect import)
(import_statement
  source: (string
    (string_fragment) @import.source)) @import.statement

; ------------------------------------------------------------
; Dynamic imports: import('path')
; ------------------------------------------------------------

(call_expression
  function: (import)
  arguments: (arguments
    (string
      (string_fragment) @import.source))) @import.statement

; ------------------------------------------------------------
; require(): const X = require('path')
; ------------------------------------------------------------

(variable_declarator
  name: [
    (identifier) @import.name
    (object_pattern
      (shorthand_property_identifier_pattern) @import.name)
  ]
  value: (call_expression
    function: (identifier) @_req
    arguments: (arguments
      (string
        (string_fragment) @import.source)))
  (#eq? @_req "require")) @import.statement

; ------------------------------------------------------------
; Re-exports
; ------------------------------------------------------------

; export { X } from 'path'
(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @export.name))
  source: (string
    (string_fragment) @import.source)) @import.statement

; export * from 'path'
(export_statement
  "export"
  "*"
  source: (string
    (string_fragment) @import.source)) @import.statement

; ------------------------------------------------------------
; Named exports (no re-export source)
; ------------------------------------------------------------

; export function X
(export_statement
  declaration: (function_declaration
    name: (identifier) @export.name)) @definition.node

; export async function X
(export_statement
  declaration: (generator_function_declaration
    name: (identifier) @export.name)) @definition.node

; export class X
(export_statement
  declaration: (class_declaration
    name: (type_identifier) @export.name)) @definition.node

; export interface X
(export_statement
  declaration: (interface_declaration
    name: (type_identifier) @export.name)) @definition.node

; export type X = ...
(export_statement
  declaration: (type_alias_declaration
    name: (type_identifier) @export.name)) @definition.node

; export enum X
(export_statement
  declaration: (enum_declaration
    name: (identifier) @export.name)) @definition.node

; export const X = ...  /  export let X = ...
(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @export.name))) @definition.node

; ------------------------------------------------------------
; Default exports
; ------------------------------------------------------------

; export default class X
(export_statement
  "default"
  (class_declaration
    name: (type_identifier) @export.name)) @definition.node

; export default function X
(export_statement
  "default"
  (function_declaration
    name: (identifier) @export.name)) @definition.node

; export default <expression>
(export_statement
  "default"
  value: (_) @export.name) @definition.node

; ------------------------------------------------------------
; Function definitions
; ------------------------------------------------------------

; Named function declaration
(function_declaration
  name: (identifier) @definition.name) @definition.node

; Async function declaration (same node, just capturing)
; Arrow function assigned to const
(variable_declarator
  name: (identifier) @definition.name
  value: [
    (arrow_function)
    (function_expression)
  ]) @definition.node

; ------------------------------------------------------------
; Class definitions
; ------------------------------------------------------------

(class_declaration
  name: (type_identifier) @definition.name
  (class_heritage
    (extends_clause
      value: (identifier) @extends.name))?
  (class_heritage
    (implements_clause
      (type_identifier) @implements.name))?
) @definition.node

; ------------------------------------------------------------
; Interface definitions
; ------------------------------------------------------------

(interface_declaration
  name: (type_identifier) @definition.name
  (extends_type_clause
    (type_identifier) @extends.name)?
) @definition.node

; ------------------------------------------------------------
; Type alias definitions
; ------------------------------------------------------------

(type_alias_declaration
  name: (type_identifier) @definition.name) @definition.node

; ------------------------------------------------------------
; Enum definitions
; ------------------------------------------------------------

(enum_declaration
  name: (identifier) @definition.name) @definition.node

; ------------------------------------------------------------
; Method definitions inside classes
; ------------------------------------------------------------

(method_definition
  name: (property_identifier) @definition.name) @definition.node

; ------------------------------------------------------------
; Function calls (call graph)
; ------------------------------------------------------------

; Simple call: foo()
(call_expression
  function: (identifier) @call.function) @call.node

; Member call: obj.method()
(call_expression
  function: (member_expression
    property: (property_identifier) @call.function)) @call.node
