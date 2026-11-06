[English](sync-setup.en.md) · [README](../README.md)

# Google Drive 동기화 설정

Nopsidian은 **본인의 Google Cloud 프로젝트**로 Drive에 접근합니다(앱 자체 서버·계정 없음, ADR-0001).
권한은 `drive.file` 하나뿐이라 앱이 만든 파일만 보이고, 기존 Drive 파일에는 접근하지 못합니다.

이 문서는 **사용자 본인이 쓰는 전용 빌드**를 기준으로 합니다. Google Cloud 설정은 한 번만 하고,
그 클라이언트 ID와 보안 비밀을 앱 빌드에 넣으면 각 기기에서는 **Google로 로그인**만 하면 됩니다.
공개 소스 빌드나 CI 빌드처럼 값이 없는 빌드는 예전처럼 앱 안에서 직접 입력할 수 있습니다.

## 1. Google Cloud 설정 (한 번만)
1. <https://console.cloud.google.com/> 에서 새 프로젝트를 만든다.
2. **API 및 서비스 → 라이브러리** 에서 *Google Drive API* 를 사용 설정한다.
3. 왼쪽 메뉴의 **Google Auth Platform** (예전 이름: OAuth 동의 화면)을 연다. 처음이면 **Get Started**를 누른다.
   - **브랜딩(Branding)** (예전 이름: OAuth 동의 화면의 앱 정보): 앱 이름, 사용자 지원 이메일, 개발자 연락처를 입력하고 Google API Services 사용자 데이터 정책에 동의한 뒤 만든다.
   - **대상(Audience)** (예전 이름: OAuth 동의 화면의 사용자 유형·게시 상태): 사용자 유형을 **외부(External)** 로 둔다. 테스트 상태에서는 refresh token이 7일 뒤 만료되므로, **프로덕션으로 게시(Publish app)** 를 눌러 **프로덕션(In production)** 으로 바꾼다. 테스트 상태로 두는 동안에는 본인 계정을 테스트 사용자로 추가한다.
   - **데이터 액세스(Data Access)** (예전 이름: OAuth 동의 화면의 범위): **Add or Remove Scopes** 에서 `https://www.googleapis.com/auth/drive.file` 을 추가하고 저장한다. `drive.file`은 민감하지 않은 범위라 앱 검증은 필요 없다.
4. **클라이언트(Clients)** (예전 이름: 사용자 인증 정보의 OAuth 클라이언트 ID): **Create Client** → 애플리케이션 유형 **데스크톱 앱(Desktop app)** 을 만든다.
5. 만들어진 **클라이언트 ID**와 **클라이언트 보안 비밀**을 복사한다. 보안 비밀은 생성 직후 한 번만 전체가 보이고 이후에는 콘솔에 끝 4자리만 보이므로, 바로 안전한 곳에 보관한다.

> 위 메뉴 이름은 Google 공식 문서의 [OAuth 동의 화면 구성](https://developers.google.com/workspace/guides/configure-oauth-consent), [Audience 설정](https://support.google.com/cloud/answer/15549945), [Clients 관리](https://support.google.com/cloud/answer/15549257)에서 확인했다. 콘솔에 처음 접속해 **Google Auth Platform not configured yet** 이 보이면 공식 문서의 [Get started with Google Auth platform](https://support.google.com/cloud/answer/15544987) **Get Started** 흐름을 따른다.

> 데스크톱 앱의 client secret은 설치형 앱에서 완전한 비밀은 아니지만, 저장소에 올리거나 빌드 결과물을 공개하면 안 된다.

## 2. 앱에서 연결

### 전용 빌드에 키 넣기
1. `apps/desktop/.env.gdrive.local.example` 을 `apps/desktop/.env.gdrive.local` 로 복사한다.
2. 두 값을 채운다.

```sh
NOPS_GDRIVE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
NOPS_GDRIVE_CLIENT_SECRET=xxxx
```

`apps/desktop/.env.gdrive.local` 은 `.gitignore`에 의해 git에서 제외됩니다. 환경 변수로 넘겨도 됩니다.

```sh
cd apps/desktop
NOPS_GDRIVE_CLIENT_ID='…' NOPS_GDRIVE_CLIENT_SECRET='…' pnpm package
```

- 값은 **main 번들에만** 들어가고 renderer/preload에는 들어가지 않습니다.
- 값이 없으면 수동 입력 빌드로 동작합니다(공개 소스·CI).
- 빌드 결과물(`dmg`·`zip`·설치 exe)에는 키가 들어 있으므로 **공개 공유하거나 GitHub에 올리면 안 됩니다.**

### 첫 실행
1. 앱에서 볼트를 연다.
2. 사이드바의 **☁ 동기화**를 연다.
3. 내장 클라이언트가 있으면 **Google로 로그인** 버튼만 누르면 된다. 브라우저에서 로그인·허용 후 앱으로 돌아온다.
4. 로그인 직후 첫 동기화 미리보기가 열린다. **이 볼트를 Drive와 동기화**를 켜고 계획을 확인한 뒤 실행한다.
5. 이후에는 파일이 바뀐 뒤 10초, 그리고 2분마다 자동으로 동기화한다.

첫 동기화 전 확인 단계는 안전장치이므로 그대로 유지된다. 로그인만으로 파일을 올리거나 지우지 않는다.

## 3. 두 번째 기기
같은 클라이언트가 들어간 앱 빌드를 설치하고, **같은 이름의 빈 폴더**를 볼트로 연다.
Drive 폴더는 볼트 이름으로 매칭된다: `Nopsidian/<볼트 이름>/`.
첫 동기화 미리보기에서 "내려받기"가 나열되면 맞게 연결된 것이다.

## 고급: 다른 클라이언트 쓰기
- 사용자가 **직접 입력한 클라이언트가 있으면 내장 클라이언트보다 우선**한다.
- 내장 클라이언트로 되돌리면 직접 입력한 설정은 지워지고, 다른 클라이언트의 refresh token도 재사용하지 않는다. 다시 로그인해야 한다.
- 클라이언트를 바꾸면 기존 토큰은 자동으로 정리된다. 다른 클라이언트의 refresh token은 쓸 수 없다.
- 수동 입력 값도 OS 키체인(`safeStorage`)으로 암호화해 이 기기에만 저장한다.

## 문제 해결
설정 창의 **진단**에서 토큰 만료, 마지막 동기화, 실패 사유, Drive 폴더 상태를 한 번에 볼 수 있다.
**지금 확인**은 토큰과 `Nopsidian/<볼트 이름>/` 폴더만 읽고, 동기화·업로드·삭제는 하지 않는다.

| 화면의 오류 | 확인할 것 |
|---|---|
| Google 로그인이 만료됐어요 (`HTTP 401`) | **지금 확인**은 먼저 refresh token으로 갱신을 시도한다. 잠시 뒤 다시 확인하고, 동기화가 계속 401이면 Google 계정을 다시 연결한다. |
| Drive API가 꺼져 있어요 (`accessNotConfigured`) | Google Cloud 콘솔 → API 및 서비스 → 라이브러리에서 **Google Drive API**를 사용 설정한다. |
| 저장 공간이 부족해요 (`storageQuotaExceeded`) | Google Drive 저장 공간을 비우거나 다른 계정을 쓴다. |
| 요청이 제한됐어요 (`rateLimitExceeded`, `dailyLimitExceeded`) | 1~5분 뒤 **지금 확인**을 다시 누른다. |
| 인터넷에 연결되지 않았어요 (`NETWORK`) | 네트워크를 확인한 뒤 다시 시도한다. |
| Drive 접근 권한이 없어요 (`HTTP 403`) | Google 계정 권한과 클라이언트 설정을 확인한다. |
| Google 쪽 일시 오류예요 (`HTTP 5xx`) | 잠시 뒤 다시 시도한다. |
| Drive에서 파일이나 폴더를 찾을 수 없어요 (`HTTP 404`) | 다시 확인하거나 동기화를 다시 실행한다. |
| Drive 폴더를 찾을 수 없어요 (`FOLDER_MISSING`) | 두 번째 기기라면 같은 이름의 볼트를 열었는지 확인한다. 첫 동기화 전에는 폴더가 없는 것이 정상이다. |

**진단 정보 복사**는 클라이언트 출처(내장/직접 입력), 클라이언트 ID 끝 4자리, 보안 비밀 등록 여부, 계정 연결 여부, 폴더 존재 여부, 오류 코드만 복사한다.
토큰·비밀 값·이메일(마스킹 포함)·폴더 ID/경로·노트 이름/경로는 복사하지 않는다.

## 동작 요약
- 한쪽만 바뀌면 그쪽을 따른다. 양쪽이 다른 블록을 고치면 자동 병합, 같은 블록을 고치면 양쪽 내용을 모두 남기고 충돌로 표시한다.
- 삭제는 상대 쪽 휴지통(로컬 `.nopsidian/trash/`, Drive 휴지통)으로 간다. 한 번에 파일의 20%를 넘게 지우려 하면 멈추고 묻는다.
- 이름 변경·이동은 다시 올리지 않고 Drive에서도 이동으로 처리한다.
- 동기화 제외: `.nopsidian/` 아래의 인덱스·기록·휴지통·동기화 상태(단 `config.json`, `graph.json`, `comments/`는 포함), `.git/`, 임시 파일.
- Drive 웹에서 파일을 고쳐도 반영된다(내용 해시를 다시 계산한다).
