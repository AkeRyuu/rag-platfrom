; ============================================================
; Go tree-sitter queries
; Grammar: tree-sitter-go
; ============================================================

; ------------------------------------------------------------
; Imports
; ------------------------------------------------------------

; import "pkg"
(import_declaration
  (import_spec
    path: (interpreted_string_literal) @import.source)) @import.statement

; import pkg "path"  (with alias)
(import_declaration
  (import_spec
    name: (package_identifier) @import.name
    path: (interpreted_string_literal) @import.source)) @import.statement

; import (
;   "pkg1"
;   alias "pkg2"
; )
(import_declaration
  (import_spec_list
    (import_spec
      path: (interpreted_string_literal) @import.source))) @import.statement

(import_declaration
  (import_spec_list
    (import_spec
      name: (package_identifier) @import.name
      path: (interpreted_string_literal) @import.source))) @import.statement

; . imports (dot import)
(import_declaration
  (import_spec
    name: (dot) @import.name
    path: (interpreted_string_literal) @import.source)) @import.statement

; blank imports
(import_declaration
  (import_spec
    name: (blank_identifier) @import.name
    path: (interpreted_string_literal) @import.source)) @import.statement

; ------------------------------------------------------------
; Function declarations
; ------------------------------------------------------------

; func Foo(...)
(function_declaration
  name: (identifier) @definition.name
  parameters: (parameter_list)
  result: [
    (parameter_list)
    (type_identifier)
  ]?) @definition.node

; func Foo(...) (without result)
(function_declaration
  name: (identifier) @definition.name) @definition.node

; ------------------------------------------------------------
; Method declarations (with receiver)
; ------------------------------------------------------------

; func (r *Receiver) Method(...)
(method_declaration
  receiver: (parameter_list
    (parameter_declaration
      type: [
        (pointer_type
          (type_identifier) @extends.name)
        (type_identifier) @extends.name
      ]))
  name: (field_identifier) @definition.name) @definition.node

; ------------------------------------------------------------
; Type declarations
; ------------------------------------------------------------

; type Foo struct { ... }
(type_declaration
  (type_spec
    name: (type_identifier) @definition.name
    type: (struct_type))) @definition.node

; type Foo interface { ... }
(type_declaration
  (type_spec
    name: (type_identifier) @definition.name
    type: (interface_type))) @definition.node

; type Foo = Bar  (type alias)
(type_declaration
  (type_spec
    name: (type_identifier) @definition.name
    type: (type_identifier) @extends.name)) @definition.node

; type Foo Bar  (type definition, no =)
(type_declaration
  (type_spec
    name: (type_identifier) @definition.name)) @definition.node

; ------------------------------------------------------------
; Interface embedding
; ------------------------------------------------------------

; interface { SomeInterface }
(interface_type
  (type_elem
    (type_identifier) @implements.name))

; ------------------------------------------------------------
; Struct embedding
; ------------------------------------------------------------

; struct { EmbeddedType }
(struct_type
  (field_declaration_list
    (field_declaration
      name: (field_identifier)?
      type: (type_identifier) @extends.name)))

; ------------------------------------------------------------
; Function calls (call graph)
; ------------------------------------------------------------

; foo()
(call_expression
  function: (identifier) @call.function) @call.node

; pkg.Func()  or  obj.Method()
(call_expression
  function: (selector_expression
    field: (field_identifier) @call.function)) @call.node
