import os
import sys
import types
import unittest
import importlib.util

sys.path.insert(0, os.path.dirname(__file__))

# The parser is deliberately unit-tested without requiring the optional Flask
# runtime used by the web server.
if importlib.util.find_spec('flask') is None:
    flask_stub = types.ModuleType('flask')

    class StubApp:
        def route(self, *args, **kwargs):
            return lambda func: func

    flask_stub.Flask = lambda *args, **kwargs: StubApp()
    flask_stub.request = None
    flask_stub.jsonify = lambda value, *args, **kwargs: value
    flask_stub.send_from_directory = lambda *args, **kwargs: None
    cors_stub = types.ModuleType('flask_cors')
    cors_stub.CORS = lambda app: app
    sys.modules['flask'] = flask_stub
    sys.modules['flask_cors'] = cors_stub

from server import parse_ast_json


class AstJsonParserTests(unittest.TestCase):
    def setUp(self):
        self.path = os.path.join(os.path.dirname(__file__), 'submitted.c')
        self.code = 'int main(void) {\n  int *p = malloc(4);\n  return p != 0;\n}\n'

    def source_location(self, line, col=1):
        return {'file': self.path, 'line': line, 'col': col}

    def test_keeps_source_tree_and_excludes_header_declarations(self):
        raw = {
            'id': 'root', 'kind': 'TranslationUnitDecl', 'inner': [
                {'id': 'header', 'kind': 'FunctionDecl', 'name': 'printf',
                 'loc': {'file': '/usr/include/stdio.h', 'line': 10, 'col': 1}},
                {'id': 'main', 'kind': 'FunctionDecl', 'name': 'main',
                 'loc': self.source_location(1), 'type': {'qualType': 'int (void)'},
                 'inner': [
                     {'id': 'body', 'kind': 'CompoundStmt', 'inner': [
                         {'id': 'var', 'kind': 'VarDecl', 'name': 'p',
                          'loc': self.source_location(2, 3), 'type': {'qualType': 'int *'}},
                         {'id': 'return', 'kind': 'ReturnStmt',
                          'loc': self.source_location(3, 3)}
                     ]}
                 ]}
            ]
        }

        tree = parse_ast_json(raw, self.path, self.code)
        self.assertEqual(tree['kind'], 'TranslationUnitDecl')
        self.assertEqual([child['id'] for child in tree['children']], ['main'])
        self.assertEqual(tree['children'][0]['label'], 'Function declaration')
        body = tree['children'][0]['children'][0]
        self.assertEqual(body['kind'], 'CompoundStmt')
        self.assertEqual([child['kind'] for child in body['children']], ['VarDecl', 'ReturnStmt'])
        self.assertEqual(body['children'][0]['sourceExcerpt'], 'int *p = malloc(4);')

    def test_preserves_metadata_ranges_and_implicit_nodes(self):
        raw = {
            'id': 'root', 'kind': 'TranslationUnitDecl', 'inner': [
                {'id': 'cast', 'kind': 'ImplicitCastExpr', 'isImplicit': True,
                 'loc': self.source_location(2, 12),
                 'range': {'begin': self.source_location(2, 12), 'end': self.source_location(2, 20)},
                 'castKind': 'LValueToRValue', 'type': {'qualType': 'int'},
                 'inner': []}
            ]
        }

        tree = parse_ast_json(raw, self.path, self.code)
        node = tree['children'][0]
        self.assertEqual(node['kind'], 'ImplicitCastExpr')
        self.assertEqual(node['location']['endLine'], 2)
        self.assertTrue(node['isImplicit'])
        self.assertEqual(node['metadata']['castKind'], 'LValueToRValue')

    def test_handles_partial_or_malformed_ast_nodes_without_locations(self):
        raw = {
            'id': 'root', 'kind': 'TranslationUnitDecl', 'inner': [
                {'id': 'main', 'kind': 'FunctionDecl', 'name': 'main',
                 'loc': self.source_location(1), 'inner': [
                     {'id': 'broken', 'kind': 'RecoveryExpr', 'inner': []}
                 ]}
            ]
        }

        tree = parse_ast_json(raw, self.path, self.code)
        self.assertEqual(tree['children'][0]['children'][0]['kind'], 'RecoveryExpr')
        self.assertEqual(tree['children'][0]['children'][0]['location']['file'], self.path)

    def test_uses_macro_expansion_location_in_submitted_source(self):
        raw = {
            'id': 'root', 'kind': 'TranslationUnitDecl', 'inner': [
                {'id': 'macro', 'kind': 'CallExpr',
                 'loc': {
                     'spellingLoc': {'file': '/usr/include/stdlib.h', 'line': 12, 'col': 1},
                     'expansionLoc': self.source_location(2, 12)
                 }, 'inner': []}
            ]
        }

        tree = parse_ast_json(raw, self.path, self.code)
        self.assertEqual(tree['children'][0]['id'], 'macro')
        self.assertEqual(tree['children'][0]['location']['file'], self.path)


if __name__ == '__main__':
    unittest.main()
