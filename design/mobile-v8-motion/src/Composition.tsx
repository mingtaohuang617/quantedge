import { AbsoluteFill, Composition, Folder, Sequence } from "remotion";
import { AlertScene } from "./scenes/AlertScene";
import { MoreHubScene } from "./scenes/MoreHubScene";
import { ScoringScene } from "./scenes/ScoringScene";
import { SystemScene } from "./scenes/SystemScene";

export const MobileV8Film: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#08090E" }}>
      <Sequence durationInFrames={180} name="01 System shell">
        <SystemScene />
      </Sequence>
      <Sequence from={180} durationInFrames={180} name="02 Scoring detail">
        <ScoringScene />
      </Sequence>
      <Sequence from={360} durationInFrames={180} name="03 Alert resolution">
        <AlertScene />
      </Sequence>
      <Sequence from={540} durationInFrames={180} name="04 More hub">
        <MoreHubScene />
      </Sequence>
    </AbsoluteFill>
  );
};

export const MobileV8Compositions: React.FC = () => {
  return (
    <>
      <Folder name="Mobile-v8-Scenes">
        <Composition id="SystemScene" component={SystemScene} durationInFrames={180} fps={30} width={720} height={1280} />
        <Composition id="ScoringScene" component={ScoringScene} durationInFrames={180} fps={30} width={720} height={1280} />
        <Composition id="AlertScene" component={AlertScene} durationInFrames={180} fps={30} width={720} height={1280} />
        <Composition id="MoreHubScene" component={MoreHubScene} durationInFrames={180} fps={30} width={720} height={1280} />
      </Folder>
      <Composition id="QuantEdge-Mobile-v8" component={MobileV8Film} durationInFrames={720} fps={30} width={720} height={1280} />
    </>
  );
};
