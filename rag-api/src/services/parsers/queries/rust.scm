; ============================================================
; Rust tree-sitter queries
; Grammar: tree-sitter-rust
; ============================================================

; ------------------------------------------------------------
; Use declarations (imports)
; ------------------------------------------------------------

; use std::io;
(use_declaration
  argument: (scoped_identifier
    path: (identifier) @import.source
    name: (identifier) @import.name)) @import.statement

; use std::io::Write;
(use_declaration
  argument: (scoped_identifier) @import.name) @import.statement

; use std::io::{Read, Write};
(use_declaration
  argument: (scoped_use_list
    path: (identifier) @import.source
    list: (use_list
      (identifier) @import.name))) @import.statement

(use_declaration
  argument: (scoped_use_list
    path: (scoped_identifier) @import.source
    list: (use_list
      (identifier) @import.name))) @import.statement

; use foo::*;
(use_declaration
  argument: (scoped_use_list
    path: (_) @import.source
    list: (use_list
      (use_wildcard)))) @import.statement

; use foo as bar;
(use_declaration
  argument: (use_as_clause
    path: (_) @import.source
    alias: (identifier) @import.name)) @import.statement

; full use path
(use_declaration
  argument: (_) @import.source) @import.statement

; ------------------------------------------------------------
; Function definitions
; ------------------------------------------------------------

; fn foo(...)
(function_item
  name: (identifier) @definition.name
  parameters: (parameters)
  return_type: (type_identifier)?) @definition.node

; fn foo (without explicit return type)
(function_item
  name: (identifier) @definition.name) @definition.node

; ------------------------------------------------------------
; Struct definitions
; ------------------------------------------------------------

; struct Foo { ... }
(struct_item
  name: (type_identifier) @definition.name) @definition.node

; ------------------------------------------------------------
; Enum definitions
; ------------------------------------------------------------

; enum Foo { ... }
(enum_item
  name: (type_identifier) @definition.name) @definition.node

; ------------------------------------------------------------
; Trait definitions
; ------------------------------------------------------------

; trait Foo { ... }
(trait_item
  name: (type_identifier) @definition.name) @definition.node

; trait Foo: Bar  (supertrait)
(trait_item
  name: (type_identifier) @definition.name
  bounds: (trait_bounds
    (type_identifier) @extends.name)) @definition.node

; ------------------------------------------------------------
; Impl blocks
; ------------------------------------------------------------

; impl Foo { ... }
(impl_item
  type: (type_identifier) @definition.name) @definition.node

; impl Trait for Foo { ... }
(impl_item
  trait: (type_identifier) @implements.name
  type: (type_identifier) @definition.name) @definition.node

; impl Trait for generic<T>
(impl_item
  trait: (scoped_type_identifier) @implements.name
  type: (type_identifier) @definition.name) @definition.node

; impl generic type (without trait)
(impl_item
  type: (generic_type
    type: (type_identifier) @definition.name)) @definition.node

; ------------------------------------------------------------
; Type aliases
; ------------------------------------------------------------

; type Foo = Bar;
(type_item
  name: (type_identifier) @definition.name) @definition.node

; ------------------------------------------------------------
; Associated functions inside impl (methods)
; ------------------------------------------------------------

(impl_item
  body: (declaration_list
    (function_item
      name: (identifier) @definition.name) @definition.node))

; ------------------------------------------------------------
; Function calls (call graph)
; ------------------------------------------------------------

; foo()
(call_expression
  function: (identifier) @call.function) @call.node

; foo::bar()
(call_expression
  function: (scoped_identifier
    name: (identifier) @call.function)) @call.node

; obj.method()
(call_expression
  function: (field_expression
    field: (field_identifier) @call.function)) @call.node

; Foo::bar() or SomeType::new()
(call_expression
  function: (scoped_identifier
    path: (identifier) @call.function)) @call.node
