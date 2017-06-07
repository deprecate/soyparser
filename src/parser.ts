import {parseTemplateName, reverseJoin} from './util';
import * as P from 'parsimmon';
import * as S from './types';

/* Parsers */

const asterisk = P.string('*');
const closingBrace = P.string('/}');
const colon = P.string(':');
const comma = P.string(',');
const docEnd = P.string('*/');
const docStart = P.string('/**');
const dollar = P.string('$');
const dot = P.string('.')
const dquote = P.string('"');
const lbracket = P.string('[');
const lparen = P.string('(');
const newLine = P.string('\n');
const qmark = P.string('?');
const rbrace = P.string('}');
const rbracket = P.string(']');
const rparen = P.string(')');
const space = P.string(' ');
const squote = P.string('\'');
const underscore = P.string('_');

const attributeName = joined(P.letter, P.string('-'));
const html = P.noneOf('{}').many().desc("Html Char");

const identifierName = P.seqMap(
  P.alt(P.letter, underscore),
  P.alt(P.letter, underscore, P.digit).many(),
  (start, rest) => start + rest.join('')
);

const namespace: P.Parser<Array<string>> = P.lazy(() => P.alt(
  P.seqMap(identifierName, dot.then(namespace), reverseJoin),
  identifierName
));

const templateName = optional(dot)
  .then(namespace)
  .map(parseTemplateName);

const namespaceCmd = P.string('{namespace')
  .skip(P.whitespace)
  .then(namespace)
  .skip(rbrace);

const stringLiteral = nodeMap(
  S.StringLiteral,
  squote.then(withAny(squote))
);

const booleanLiteral = nodeMap(
  S.BooleanLiteral,
  P.alt(
    P.string('true').result(true),
    P.string('false').result(false))
);

const numberLiteral = nodeMap(
  S.NumberLiteral,
  P.seq(
    P.oneOf('+-').fallback(''),
    joined(P.digit, P.string('.'))
  ).map(([sign, number]) => parseFloat(sign + number))
);

const param = P.lazy(() => nodeMap(
  S.Param,
  P.string('{param')
    .then(spaced(identifierName)),
  P.alt(
    spaced(attribute.many()).skip(rbrace).then(bodyFor('param')),
    spaced(colon).then(expression(closingBrace)))
));

const functionCall = P.lazy(() => nodeMap(
  S.FunctionCall,
  identifierName,
  lparen.then(functionArgs)
));

const functionArgs: P.Parser<Array<S.Expression>> = P.lazy(() => P.alt(
  rparen.result([]),
  expression(rparen).map(result => [result]),
  P.seqMap(expression(comma), functionArgs, reverseJoin),
));

const reference = nodeMap(
  S.Reference,
  dollar.then(identifierName)
);

const letStatement = P.lazy(() => nodeMap(
  S.LetStatement,
  P.string('{let')
    .skip(P.whitespace)
    .skip(dollar)
    .then(identifierName),
  P.alt(
    spaced(attribute.many()).skip(rbrace).then(bodyFor('let')),
    spaced(colon).then(expression(closingBrace)))
));

const mapItem = nodeMap(
  S.MapItem,
  stringLiteral,
  spaced(colon).then(expression(P.alt(comma, rbracket)))
);

const mapLiteral = nodeMap(
  S.MapLiteral,
  lbracket.then(P.alt(
    spaced(mapItem).many(),
    rbracket.result([])))
);

const call = nodeMap(
  S.Call,
  P.string('{call')
    .skip(P.whitespace)
    .then(templateName),
  P.alt(
    spaced(closingBrace).result([]),
    rbrace.then(spaced(param).many())
      .skip(spaced(closeCmd('call'))))
);

const attribute = nodeMap(
  S.Attribute,
  attributeName.skip(P.string('="')),
  withAny(dquote)
);

const paramDeclaration = nodeMap(
  S.ParamDeclaration,
  P.string('{@param')
    .then(optional(qmark))
    .map(value => !value),
  spaced(identifierName),
  spaced(colon)
    .then(withAny(rbrace))
);

const soyDocComment = P.optWhitespace
  .then(asterisk)
  .skip(space.many())
  .lookahead(P.noneOf('/'))
  .then(withAny(newLine.or(asterisk), false));

const soyDocParam = nodeMap(
  (mark, optional, name) => S.ParamDeclaration(mark, optional, name, 'any'),
  spaced(asterisk)
    .skip(P.string('@param'))
    .then(optional(qmark))
    .map(value => !value),
  P.whitespace.then(identifierName).skip(orAny(newLine))
);

const soyDoc = nodeMap(
  (mark, nodes) => {
    const lines: Array<string> = [];
    const params: Array<S.ParamDeclaration> = [];

    nodes.forEach(node => {
      if (typeof node === 'string') {
        lines.push(node);
      } else {
        params.push(node);
      }
    });

    return S.SoyDoc(mark, lines.join('\n'), params);
  },
  spaced(docStart)
    .then(soyDocParam.or(soyDocComment).many())
    .skip(spaced(docEnd))
);

const template = nodeMap(
  S.Template,
  optional(soyDoc),
  P.string('{template')
    .skip(P.whitespace)
    .then(templateName),
  spaced(attribute).many(),
  spaced(rbrace).then(spaced(paramDeclaration).many()),
  bodyFor('template')
);

const delTemplate = nodeMap(
  S.DelTemplate,
  optional(soyDoc),
  P.string('{deltemplate')
    .skip(P.whitespace)
    .then(templateName),
  optional(P.seq(P.whitespace, P.string('variant='))
    .then(interpolation('"'))),
  rbrace.then(spaced(paramDeclaration).many()),
  bodyFor('deltemplate')
);

const program = nodeMap(
  S.Program,
  namespaceCmd,
  spaced(P.alt(template, delTemplate))
    .atLeast(1)
    .skip(P.eof)
);

const parser = program;

/* Higher-order Parsers */

function nodeMap<T, U>(mapper: (mark: S.Mark, a1: T) => U, p1: P.Parser<T>): P.Parser<U>;
function nodeMap<T, U, V>(mapper: (mark: S.Mark, a1: T, a2: U) => V, p1: P.Parser<T>, p2: P.Parser<U>): P.Parser<V>;
function nodeMap<T, U, V, W>(mapper: (mark: S.Mark, a1: T, a2: U, a3: V) => W, p1: P.Parser<T>, p2: P.Parser<U>, p3: P.Parser<V>): P.Parser<W>;
function nodeMap<T, U, V, W, X>(mapper: (mark: S.Mark, a1: T, a2: U, a3: V, a4: W) => X, p1: P.Parser<T>, p2: P.Parser<U>, p3: P.Parser<V>, p4: P.Parser<W>): P.Parser<X>;
function nodeMap<T, U, V, W, X, Y>(mapper: (mark: S.Mark, a1: T, a2: U, a3: V, a4: W, a5: X) => Y, p1: P.Parser<T>, p2: P.Parser<U>, p3: P.Parser<V>, p4: P.Parser<W>, p5: P.Parser<X>): P.Parser<Y>;
function nodeMap(mapper: any, ...parsers: Array<any>) {
  return P.seq(...parsers)
    .mark()
    .map(({start, value, end}) => {
      return mapper({
        start,
        end
      }, ...value);
    });
}

function optional<T>(parser: P.Parser<T>): P.Parser<T | null> {
  return parser
    .atMost(1)
    .map(values => values[0] || null);
}

function expression<T>(end: P.Parser<T>, stack: Array<S.Expression> = []): P.Parser<S.Expression> {
  const spacedEnd = P.optWhitespace.then(end);

  return realExpression(spacedEnd, stack)
    .or(otherExpression(spacedEnd, stack));
}

function realExpression<T>(end: P.Parser<T>, stack: Array<S.Expression>): P.Parser<S.Expression> {
  return P.lazy(() => P.alt(
    reference,
    stringLiteral,
    booleanLiteral,
    mapLiteral,
    numberLiteral,
    functionCall
  ).chain(tryOperator(end, stack)));
}

function otherExpression<T>(end: P.Parser<T>, stack: Array<S.Expression>): P.Parser<S.Expression> {
  return nodeMap(
    S.OtherExpression,
    withAny(end, false)
  ).chain(tryOperator(end, stack));
}

function tryOperator<T>(
  end: P.Parser<T>,
  stack: Array<S.Expression>
  ): (result: S.Expression) => P.Parser<S.Expression> {
  return result => withOperator([...stack, result], end);
}

function withOperator<T>(stack: Array<S.Expression>, end: P.Parser<T>): P.Parser<S.Expression> {
  switch(stack.length) {
    case 1:
      return P.alt(
        ternaryLeft(end, stack),
        P.succeed(stack[0])
      ).skip(end);
    case 2:
      return ternaryRight(end, stack);
    case 3:
      const [cond, left, right] = stack;
      return P.succeed(S.Ternary(
        combineMark(cond.mark, right.mark),
        cond,
        left,
        right));
    default:
      throw new SoyParseError(`Error parsing an operator of length ${stack.length}.`);
  }
}

function ternaryLeft<T>(end: P.Parser<T>, stack: Array<S.Expression>): P.Parser<S.Expression> {
  return P.whitespace
    .skip(qmark)
    .skip(P.whitespace)
    .then(expression(end, stack));
}

function ternaryRight<T>(end: P.Parser<T>, stack: Array<S.Expression>): P.Parser<S.Expression> {
  return P.whitespace
    .skip(colon)
    .skip(P.whitespace)
    .then(expression(end, stack));
}

function interpolation(start: string, end: string = start): P.Parser<S.Interpolation> {
  return nodeMap(
    S.Interpolation,
    P.string(start).then(withAny(P.string(end)))
  );
}

function otherCmd(name: string, ...inter: Array<string>): P.Parser<S.OtherCmd> {
  return nodeMap(
    (mark, body) => S.OtherCmd(mark, name, body),
    openCmd(name).then(bodyFor(name, ...inter))
  );
}

function bodyFor(name: string, ...inter: Array<String>): P.Parser<S.Body> {
  const bodyParser: P.Parser<S.Body> = P.lazy(() =>
    html.then(P.alt(
      closeCmd(name).result([]),
      P.alt(...inter.map(openCmd))
        .result([])
        .then(bodyParser),
      P.seqMap(
        P.alt(
          call,
          letStatement,
          otherCmd('if', 'elseif', 'else'),
          otherCmd('foreach', 'ifempty'),
          otherCmd('msg', 'fallbackmsg'),
          otherCmd('switch'),
          otherCmd('literal'),
          interpolation('{', '}')),
        bodyParser,
        reverseJoin)))
  );

  return bodyParser;
}

function orAny<T>(parser: P.Parser<T>): P.Parser<T> {
  const newParser: P.Parser<T> = P.lazy(() =>
    parser.or(P.any.then(newParser))
  );

  return newParser;
}

function withAny<T>(parser: P.Parser<T>, consumeEnd = true): P.Parser<string> {
  const newParser: P.Parser<string> = P.lazy(() =>
    P.alt(
      consumeEnd ? parser.result('') : P.lookahead(parser),
      P.seqMap(
        P.any,
        newParser,
        (s, next) => s + next))
  );

  return newParser;
}

function spaced<T>(parser: P.Parser<T>): P.Parser<T> {
  return P.optWhitespace
    .then(parser)
    .skip(P.optWhitespace);
}

function joined(...parsers: Array<P.Parser<string>>): P.Parser<string> {
  return P.alt(...parsers)
    .atLeast(1)
    .map(values => values.join(''));
}

function closeCmd(name: string): P.Parser<string> {
  return P.string(`{/${name}}`);
}

function openCmd(name: string): P.Parser<string> {
  return P.string(`{${name}`).skip(orAny(rbrace));
}

function combineMark(start: S.Mark, end: S.Mark): S.Mark {
  return {
    start: start.start,
    end: end.end
  };
}

/* API */

export class SoyParseError extends Error {}

export default function parse(input: string): S.Program {
  const result = parser.parse(input);
  if (!result.status) {
    throw new SoyParseError(`Parsing failed at ${result.index.line}:${result.index.column}. Expecting:\n${result.expected.join('\n')}`);
  }
  return result.value;
};
