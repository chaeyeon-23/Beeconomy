import { useState } from "react";
import {
  AgreementV4,
  Asset,
  BottomCTA,
  Button,
  CTAButton,
  List,
  ListRow,
  Spacing,
  StepperRow,
  TableRow,
  Text,
  TextField,
  Top,
} from "@toss/tds-mobile";
import { adaptive } from "@toss/tds-colors";
import "./App.css";

type Screen = "welcome" | "nickname" | "budget" | "home";

const APP_ICON =
  "https://static.toss.im/appsintoss/31139/53105092-e2a9-454b-8a6e-eb7808a98977.png";
const BEE_EMOJI = "https://static.toss.im/2d-emojis/png/4x/u1F41D.png";
const HAND_EMOJI = "https://static.toss.im/2d-emojis/png/4x/u1F590_u1F3FC.png";
const HONEY_EMOJI = "https://static.toss.im/2d-emojis/png/4x/u1F36F.png";
const priceFormat = {
  transform: (value: string | number) =>
    `${value}`.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  reset: (value: string | number) => `${value}`.replace(/\D/g, ""),
};

function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [agreed, setAgreed] = useState(false);
  const [nickname, setNickname] = useState("");
  const [budget, setBudget] = useState("");

  return (
    <main className="app-shell">
      <AppHeader />

      {screen === "welcome" && (
        <WelcomeScreen
          agreed={agreed}
          onToggleAgreement={() => setAgreed(value => !value)}
          onNext={() => setScreen("nickname")}
        />
      )}
      {screen === "nickname" && (
        <NicknameScreen
          nickname={nickname}
          onChangeNickname={setNickname}
          onNext={() => setScreen("budget")}
        />
      )}
      {screen === "budget" && (
        <BudgetScreen
          budget={budget}
          onChangeBudget={setBudget}
          onBack={() => setScreen("nickname")}
          onNext={() => setScreen("home")}
        />
      )}
      {screen === "home" && <HomeScreen onEditBudget={() => setScreen("budget")} />}
    </main>
  );
}

function AppHeader() {
  return (
    <header className="app-header">
      <button className="icon-button" type="button" aria-label="뒤로 가기">
        <Asset.Icon
          frameShape={Asset.frameShape.CleanW24}
          backgroundColor="transparent"
          name="icon-arrow-back-ios-mono"
          color={adaptive.grey900}
          aria-hidden={true}
          ratio="1/1"
        />
      </button>

      <div className="brand">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW16}
          backgroundColor="transparent"
          src={APP_ICON}
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
        <Text color={adaptive.grey900} typography="t6" fontWeight="semibold">
          비코노미
        </Text>
      </div>

      <div className="header-actions">
        <button className="pill-icon-button" type="button" aria-label="좋아요">
          <Asset.Icon
            frameShape={Asset.frameShape.CleanW20}
            backgroundColor="transparent"
            name="icon-heart-mono"
            color={adaptive.greyOpacity600}
            aria-hidden={true}
            ratio="1/1"
          />
        </button>
        <div className="segmented-actions">
          <button className="pill-icon-button" type="button" aria-label="더 보기">
            <Asset.Icon
              frameShape={Asset.frameShape.CleanW20}
              backgroundColor="transparent"
              name="icon-dots-mono"
              color={adaptive.greyOpacity600}
              aria-hidden={true}
              ratio="1/1"
            />
          </button>
          <span className="header-divider" />
          <button className="pill-icon-button" type="button" aria-label="닫기">
            <Asset.Icon
              frameShape={Asset.frameShape.CleanW20}
              backgroundColor="transparent"
              name="icon-x-mono"
              color={adaptive.greyOpacity600}
              aria-hidden={true}
              ratio="1/1"
            />
          </button>
        </div>
      </div>
    </header>
  );
}

function WelcomeScreen({
  agreed,
  onToggleAgreement,
  onNext,
}: {
  agreed: boolean;
  onToggleAgreement: () => void;
  onNext: () => void;
}) {
  return (
    <section className="screen welcome-screen">
      <Top
        title={
          <Top.TitleParagraph size={28} color="#000000">
            일침이와 함께 예산을 관리해보세요
          </Top.TitleParagraph>
        }
      />

      <Spacing size={84} />
      <div className="emoji-row">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW100}
          backgroundColor="transparent"
          src={BEE_EMOJI}
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
      </div>
      <Spacing size={30} />

      <div className="stepper-panel">
        <StepperRow
          left={<StepperRow.NumberIcon number={1} />}
          center={<StepperRow.Texts type="A" title="예산을 입력하고" description="" />}
        />
        <StepperRow
          left={<StepperRow.NumberIcon number={2} />}
          center={<StepperRow.Texts type="A" title="일정과 소비를 입력하면" description="" />}
        />
        <StepperRow
          left={<StepperRow.NumberIcon number={3} />}
          center={
            <StepperRow.Texts
              type="A"
              title="일침이가 소비를 예상해줘요"
              description=""
            />
          }
          hideLine={true}
        />
      </div>

      <Spacing size={11} />
      <button className="agreement-button" type="button" onClick={onToggleAgreement}>
        <AgreementV4
          variant="small"
          left={<AgreementV4.Checkbox variant="dot" checked={agreed} />}
          middle={<AgreementV4.Text>서비스 이용 동의</AgreementV4.Text>}
        />
      </button>

      <Spacing size={25} />
      <div className="welcome-action">
        <Button disabled={!agreed} onClick={onNext}>
          가입하기
        </Button>
      </div>
    </section>
  );
}

function NicknameScreen({
  nickname,
  onChangeNickname,
  onNext,
}: {
  nickname: string;
  onChangeNickname: (value: string) => void;
  onNext: () => void;
}) {
  return (
    <section className="screen form-screen">
      <Spacing size={40} />
      <Asset.Image
        frameShape={Asset.frameShape.CleanW100}
        backgroundColor="transparent"
        src={HAND_EMOJI}
        aria-hidden={true}
        style={{ aspectRatio: "1/1" }}
      />
      <Spacing size={24} />
      <TextField.Clearable
        variant="box"
        hasError={false}
        label="뭐라고 불러드릴까요?"
        labelOption="sustain"
        value={nickname}
        placeholder="예 : 절약왕, 김금수"
        suffix=""
        prefix=""
        onChange={event => onChangeNickname(event.target.value)}
      />
      <BottomCTA.Single disabled={nickname.trim().length === 0} onClick={onNext}>
        확인
      </BottomCTA.Single>
    </section>
  );
}

function BudgetScreen({
  budget,
  onChangeBudget,
  onBack,
  onNext,
}: {
  budget: string;
  onChangeBudget: (value: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <section className="screen budget-screen">
      <Top
        title={
          <Top.TitleParagraph size={22} color={adaptive.grey900}>
            이번 달 예산을 설정해보세요 일침이가 예산 관리를 도와줘요
          </Top.TitleParagraph>
        }
      />

      <Spacing size={44} />
      <Asset.Image
        frameShape={Asset.frameShape.CleanW100}
        backgroundColor="transparent"
        src={HONEY_EMOJI}
        aria-hidden={true}
        style={{ aspectRatio: "1/1" }}
      />
      <Spacing size={28} />

      <TextField.Clearable
        variant="box"
        hasError={false}
        label="금액"
        labelOption="sustain"
        value={budget}
        placeholder="이번 달 예산 입력하기"
        suffix="원"
        format={priceFormat}
        onChange={event => onChangeBudget(event.target.value)}
      />

      <TableRow
        align="space-between"
        left={
          <Text color={adaptive.grey700} typography="t5" fontWeight="medium">
            지난 달 사용 예산
          </Text>
        }
        right={
          <Text color={adaptive.grey700} typography="t5" fontWeight="medium">
            50만원
          </Text>
        }
        leftRatio={60}
      />

      <BottomCTA.Double
        leftButton={
          <CTAButton color="dark" variant="weak" onClick={onBack}>
            뒤로 가기
          </CTAButton>
        }
        rightButton={
          <CTAButton disabled={budget.trim().length === 0} onClick={onNext}>
            준비 완료!
          </CTAButton>
        }
      />
    </section>
  );
}

function HomeScreen({ onEditBudget }: { onEditBudget: () => void }) {
  const days = [
    { day: "수", date: "12", tone: "past" },
    { day: "목", date: "13", tone: "past" },
    { day: "금", date: "14", tone: "past" },
    { day: "토", date: "15", tone: "today" },
    { day: "일", date: "16", tone: "future" },
    { day: "월", date: "17", tone: "future" },
    { day: "화", date: "18", tone: "future" },
  ];

  return (
    <section className="screen home-screen">
      <div className="emoji-row">
        <Asset.Image
          frameShape={Asset.frameShape.CleanW100}
          backgroundColor="transparent"
          src={HONEY_EMOJI}
          aria-hidden={true}
          style={{ aspectRatio: "1/1" }}
        />
      </div>
      <Top
        title={<Top.TitleParagraph size={28}>30,000원</Top.TitleParagraph>}
        subtitleTop={
          <Top.SubtitleTextButton size="xsmall">이번 달 남은 예산</Top.SubtitleTextButton>
        }
        upperGap={40}
        right={<Top.RightButton onClick={onEditBudget}>설정하기</Top.RightButton>}
        rightVerticalAlign="end"
      />

      <Spacing size={36} />
      <div className="date-strip">
        {days.map(item => (
          <div className={`date-item ${item.tone}`} key={`${item.day}-${item.date}`}>
            <Text color={adaptive.grey500} typography="t7" fontWeight="regular">
              {item.day}
            </Text>
            <Text
              color={item.tone === "past" ? adaptive.grey500 : adaptive.grey700}
              typography="t5"
              fontWeight="bold"
            >
              {item.date}
            </Text>
          </div>
        ))}
      </div>

      <Spacing size={31} />
      <List>
        <ListRow
          left={<ListRow.Icon name="icon-emoji-money-with-wings" />}
          contents={
            <ListRow.Texts
              type="2RowTypeD"
              top="오늘의 소비를 입력하세요"
              topProps={{ color: adaptive.grey600 }}
              bottom="소비 입력하러 가기"
              bottomProps={{ color: adaptive.blue500, fontWeight: "bold" }}
            />
          }
          verticalPadding={16}
        />
        <ListRow
          left={<ListRow.Icon name="icon-emoji-money-with-wings" />}
          contents={
            <ListRow.Texts
              type="2RowTypeD"
              top="다음 일정은?"
              topProps={{ color: adaptive.grey600 }}
              bottom="13시 30분에 예원님과의 점심 약속이 있어요!"
              bottomProps={{ color: adaptive.blue500, fontWeight: "bold" }}
            />
          }
          verticalPadding={16}
        />
      </List>
    </section>
  );
}

export default App;
