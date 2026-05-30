# Sejong POS tag reference

Tags used by `extension/lemmatizer.js`. The constant sets at the top of that
file group these into logical roles; this table gives the human meaning of each.

| Tag   | Family    | Meaning                                      | Example surface | Lemma form  |
|-------|-----------|----------------------------------------------|-----------------|-------------|
| NNG   | Noun      | Common noun                                  | 학교            | 학교        |
| NNP   | Noun      | Proper noun                                  | 서울            | 서울        |
| NNB   | Noun      | Bound noun (dependent)                       | 것              | 것          |
| NR    | Noun      | Numeral                                      | 다섯            | 다섯        |
| NP    | Noun      | Pronoun                                      | 나              | 나          |
| VV    | Verb      | Verb stem                                    | 먹              | 먹다        |
| VA    | Verb      | Adjective stem (descriptive verb)            | 예쁘            | 예쁘다      |
| VX    | Verb      | Auxiliary verb stem                          | 보              | 보다        |
| VCP   | Verb      | Positive copula (이다)                       | 이              | 이다        |
| VCN   | Verb      | Negative copula (아니다)                     | 아니            | 아니다      |
| MM    | Modifier  | Pre-noun modifier (determiner)               | 한              | 한          |
| XR    | Affix     | Root (used in compounds before XSV/XSA)      | 깨끗            | (root)      |
| XSN   | Affix     | Noun suffix                                  | -들             | (suffix)    |
| XSV   | Affix     | Verb-deriving suffix                         | -하- (공부하다) | (suffix)    |
| XSA   | Affix     | Adjective-deriving suffix                    | -답- (사람답다) | (suffix)    |
| SL    | Symbol    | Foreign letters (Latin script)               | abc             | -           |
| SH    | Symbol    | Hanja                                        | 漢              | -           |
| SN    | Symbol    | Number                                       | 123             | -           |

## Constant sets in `lemmatizer.js`

| Constant             | Tags                                  | Role                                                                              |
|----------------------|---------------------------------------|-----------------------------------------------------------------------------------|
| `VERB_LEAD_TAGS`     | VV VA VX VCN VCP XSV XSA             | Build `<stem>다` per-token                                                        |
| `AMBIGUOUS_L_TAGS`   | VV VA                                 | Subset of VERB_LEAD_TAGS eligible for the ambiguous-ㄹ guard (surface+다 before decomp-stem+다 when both are single-syllable and differ). VCP/VCN/VX/XSV/XSA excluded — their lemma is fixed (이다, 아니다, 하다, etc.), not the surface form. |
| `NOUN_LEAD_TAGS`     | NNG NNP NR NP SL SH SN               | Use morpheme as-is per-token                                                      |
| `COMPOUND_PREFIX_TAGS` | NNG NNP NNB NR NP MM XR XSN       | Accumulate as prefix before an XSV/XSA — wider than NOUN_LEAD_TAGS so 한잔하다 works |
| `COMPOUND_DERIV_TAGS` | XSV XSA                             | Consume the accumulator and emit `<prefix><stem>다`                               |
| `COMPOUND_NOUN_TAGS` | NNG NNP NR NP XSN                    | Surface-first promotion when every token is one of these                          |

Tags not listed above (JK\*, E\*, SF, SP, SS, SE, SO, IC, MAG, MAJ, …) are
skipped by the lemmatizer — they are particles, endings, or punctuation, not
dictionary headwords.
