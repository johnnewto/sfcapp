import io3PcRegressionFixture from "./fixtures/r-regressions/3io-pc.json";
import defineSimpleRegressionFixture from "./fixtures/r-regressions/define-simple.json";
import eco3IoPcRegressionFixture from "./fixtures/r-regressions/eco-3io-pc.json";
import gl6DisRegressionFixture from "./fixtures/r-regressions/gl6-dis.json";
import gl7InsoutRegressionFixture from "./fixtures/r-regressions/gl7-insout.json";
import ioPcRegressionFixture from "./fixtures/r-regressions/io-pc.json";
import italySfcRegressionFixture from "./fixtures/r-regressions/italy-sfc.json";
import { runNotebookTemplateRegressionFixtures } from "./notebookTemplateRegressionHarness";

runNotebookTemplateRegressionFixtures("extended notebook template regressions against R fixtures", [
  gl6DisRegressionFixture,
  gl7InsoutRegressionFixture,
  io3PcRegressionFixture,
  eco3IoPcRegressionFixture,
  defineSimpleRegressionFixture,
  ioPcRegressionFixture,
  italySfcRegressionFixture
]);
