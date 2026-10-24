"use strict";
// ═══════════════════════════════════════════════════════════
//  I18N — русский и английский интерфейс. Статические тексты
//  правятся по id элементов, динамика — через I18N.t("ключ").
//  Выбор языка живёт в localStorage (rc_lang), флаги в настройках.
// ═══════════════════════════════════════════════════════════
(function (global) {

// id → [русский, english]
const STATIC = [
    ["btnCareerLabel", "Рейтинг", "Rating"],
    ["btnQuestsLabel", "Задания", "Quests"],
    ["quickStatus", "Ожидаем другого игрока", "Waiting for another player"],
    ["soundTitle", "Настройки", "Settings"],
    ["effectsLabel", "Звуки", "Sound effects"],
    ["musicLabel", "Музыка", "Music"],
    ["btnBotLabel", "Играть с компьютером", "Play vs Computer"],
    ["btnOnlineLabel", "Игра по сети", "Network Game"],
    ["btnPvpLabel", "Два игрока", "Two Players"],
    ["btnTrainingLabel", "Тренировка", "Training"],
    ["btnHowLabel", "Как играть", "How to Play"],
    ["btnSettingsOpenLabel", "Магазин", "Shop"],
    ["menuFoot", "V1 · НАСТОЛЬНАЯ ИГРА", "V1 · TABLE GAME"],

    ["barTitleTraining", "ТРЕНИРОВКА", "TRAINING"],
    ["barTitleNet", "ИГРА ПО СЕТИ", "NETWORK GAME"],
    ["barTitleSettings", "МАГАЗИН", "SHOP"],

    ["tFreeT", "Свободная игра", "Free Play"],
    ["tFreeD", "Стол без соперника. Оттачивайте удары и точки опоры кольца.", "Table with no opponent. Hone your shots and ring spots."],
    ["tAccT", "Точность", "Accuracy"],
    ["tAccD", "10 ударов — забейте как можно больше шашек.", "10 shots — pot as many pucks as you can."],
    ["tBrkT", "Разбой", "Break Shot"],
    ["tBrkD", "3 попытки. Один удар по пирамиде — сколько рассеете в лузы?", "3 tries. One break per try — how many scatter into pockets?"],

    ["netSegNet", "Интернет · код", "Internet · code"],
    ["netSegLan", "Wi-Fi · локально", "Wi-Fi · local"],
    ["netHostT", "Создать игру", "Create Game"],
    ["netHostD", "Получите код и передайте сопернику.", "Get a code and share it with your opponent."],
    ["netJoinT", "Присоединиться", "Join"],
    ["netJoinD", "Есть код от друга? Введите его здесь.", "Got a code from a friend? Enter it here."],
    ["labelCode", "КОД ИГРЫ", "GAME CODE"],
    ["labelJoinCode", "КОД СОПЕРНИКА", "OPPONENT'S CODE"],
    ["btnJoinGo", "Подключиться", "Connect"],
    ["lanHostT", "Создать игру", "Create Game"],
    ["lanHostD", "Телефон покажет свой адрес в Wi-Fi сети. Интернет не нужен.", "The phone shows its Wi-Fi address. No internet needed."],
    ["lanJoinT", "Присоединиться", "Join"],
    ["lanJoinD", "Найдите хост в сети или введите его адрес.", "Find the host on the network or type its address."],
    ["labelLanIp", "АДРЕС В СЕТИ WI-FI", "WI-FI ADDRESS"],
    ["labelLanHosts", "ХОСТЫ В СЕТИ", "HOSTS ON NETWORK"],
    ["labelLanManual", "ИЛИ АДРЕС ВРУЧНУЮ", "OR ENTER ADDRESS"],
    ["btnLanJoinGo", "Подключиться", "Connect"],


    ["btnOverMenu", "В меню", "Menu"],
    ["btnAgain", "Ещё раз", "Play Again"],
    ["adslot", "РЕКЛАМА", "AD"],
    ["tutorialBadge", "ОБУЧЕНИЕ", "TUTORIAL"],
    ["overH", "Партия окончена", "Game over"],
    ["confTitle", "Выйти из игры?", "Exit the game?"],
    ["tutClose", "Пропустить", "Skip"],
    ["tutNext", "Далее", "Next"],
    ["thinking", "БОТ ДУМАЕТ", "BOT IS THINKING"],
    ["winTitle", "ПОБЕДА!", "VICTORY!"],
    ["hostStatus", "Создаём игру…", "Creating game…"],
    ["lanHostStatus", "Поднимаем игру…", "Creating game…"],
];

// ключ → [русский с {n}, english с {n}]
const DYN = {
    settingsTitle: ["Настройки", "Settings"],
    languageLabel: ["Язык", "Language"],
    languageHelp: ["Русский / Английский", "Russian / English"],
    audioLabel: ["Громкость", "Volume"],
    playerLevel: ["Уровень {n}", "Level {n}"],
    xpLabel: ["ОП", "XP"],
    experienceLabel: ["Опыт до следующего уровня", "Experience towards the next level"],
    winExperience: ["+{n} опыта", "+{n} XP"],
    russianLanguage: ["Русский", "Russian"],
    englishLanguage: ["Английский", "English"],
    loginTitle: ["ПОДАРКИ ЗА ВХОД", "DAILY LOGIN GIFTS"],
    loginHelp: ["Заходите каждый день! Пропуск сбрасывает серию. После 7-го дня начинается новая неделя.", "Come back daily! A missed day resets your streak. After day 7, a new week begins."],
    loginDay: ["День {n}", "Day {n}"],
    loginClaim: ["Получить +{n}", "Claim +{n}"],
    loginClaimed: ["Получено · до завтра!", "Claimed · see you tomorrow!"],
    loginDone: ["Получено", "Claimed"],
    quickFind: ["Найти соперника", "Find an opponent"],
    quickHelp: ["Автоматический подбор игрока без кода.", "Automatic matchmaking. No code needed."],
    quickSearching: ["Поиск соперника…", "Finding an opponent…"],
    celebratePurchase: ["Отличный выбор!", "Great choice!"],
    celebratePurchaseDetail: ["Покупка уже в игре", "Your new item is equipped"],
    celebrateTutorial: ["Обучение пройдено!", "Tutorial complete!"],
    celebrateTutorialDetail: ["Теперь вы готовы к победам", "You're ready to play and win"],
    celebrateWin: ["Красивая победа!", "Brilliant victory!"],
    celebrateWinDetail: ["Отличная игра — так держать!", "Great game — keep it up!"],
    celebrateReward: ["+{n} алмазов — ваши!", "+{n} diamonds are yours!"],
    celebrateDaily: ["Награда получена!", "Reward claimed!"],
    defaultName: ["Вадим", "Vadim"],
    connectAction: ["подключиться", "connect"],
    lanNoHosts: ["Хостов пока не видно — введите адрес вручную", "No hosts found yet — enter the address manually"],
    lanCode: ["КОД {n}", "CODE {n}"],
    soundTitle: ["Звук", "Sound"],
    exitTitle: ["Выход", "Exit"],
    resetTitle: ["Заново", "Restart"],
    saveNameTitle: ["Сохранить имя", "Save name"],
    closeTitle: ["Закрыть", "Close"],
    hintPlace: ["Выберите место кольца на линии · тяните назад и отпускайте", "Pick a spot for the ring on the line · pull back and release"],
    hintTurn: ["Ход: {n}", "Turn: {n}"],
    hintYourTurn: ["Ваш ход", "Your turn"],
    hintBreak: ["Удар по пирамиде — на максимум шашек", "Break the rack — pot as many as you can"],

    toastPlus: ["+{n} · ход остаётся", "+{n} · shoot again"],
    toastFoul: ["Фол: −2 · ход переходит", "Foul: −2 · turn passes"],
    toastOppPot: ["Чужая шашка: +1 сопернику", "Opponent's puck: +1 to them"],
    toastBreak: ["Разбой {n}/3", "Break {n}/3"],
    toastCoins: ["+{n} алмазов за победу!", "+{n} diamonds for the win!"],
    toastNotEnough: ["Не хватает алмазов", "Not enough diamonds"],
    toastBought: ["Куплено!", "Purchased!"],
    toastRematch: ["Ждём согласия соперника…", "Waiting for opponent approval…"],
    confirmPeerRestart: ["Соперник предлагает начать игру заново. Текущий прогресс будет сброшен. Согласны?", "Opponent wants to restart. Current progress will be reset. Accept?"],
    restartDeclined: ["Перезапуск не подтверждён. Продолжаем игру", "Restart was not accepted. Continue playing"],
    btnDecline: ["Отказаться", "Decline"],
    confirmResume: ["У вас есть незавершённая сетевая игра. Вернуться в неё?", "You have an unfinished online game. Return to it?"],
    btnResume: ["Вернуться в игру", "Return to game"],
    btnLeaveGame: ["Покинуть игру", "Leave game"],

    nameYou: ["Вы", "You"],
    nameBot: ["Бот", "Bot"],
    nameOpp: ["Соперник", "Opponent"],
    nameP1: ["Игрок 1", "Player 1"],
    nameP2: ["Игрок 2", "Player 2"],
    colorW: ["белые", "whites"],
    colorB: ["чёрные", "blacks"],

    trainFree: ["Броски {n} · Забито {m}", "Shots {n} · Potted {m}"],
    trainAcc: ["Удар {n}/10 · Забито {m}", "Shot {n}/10 · Potted {m}"],
    trainBreak: ["Попытка {n}/3", "Try {n}/3"],
    record: ["Рекорд: {n}", "Best: {n}"],

    overAcc: ["Точность завершена", "Accuracy complete"],
    overAccRes: ["{n} из 10", "{n} out of 10"],
    overBreak: ["Разбой завершён", "Break shot complete"],
    overWin: ["{n} победил", "{n} wins"],
    overYouWin: ["Вы победили", "You won"],
    overYouLose: ["{n} победил", "{n} wins"],
    overDraw: ["Ничья", "Draw"],
    stone1: ["камень", "puck"], stone2: ["камня", "pucks"], stone5: ["камней", "pucks"],

    tutStep: ["ШАГ {n} ИЗ {m}", "STEP {n} OF {m}"],
    tut1h: ["Позиция кольца", "Ring position"],
    tut1b: ["Передвиньте кольцо ползунком под полем. Выберите удобное место для броска.", "Move the slider below the board to position your ring."],
    tut2h: ["Сила удара", "Shot power"],
    tut2b: ["Коснитесь кольца, потяните назад и отпустите. Чем сильнее натяжение, тем мощнее бросок. Попробуйте!", "Touch the ring, pull back and release. Pull farther for a stronger shot. Try it!"],
    tut3h: ["Очки", "Scoring"],
    tut3b: ["Забейте свою шайбу в угловую лузу: получите очко и ещё один бросок. Чужая шайба принесёт очко сопернику и передаст ему ход.", "Pot your puck in a corner pocket to score and shoot again. Pot an opponent's puck and they score and take the turn."],
    tut4h: ["Победа", "Victory"],
    tut4b: ["Побеждает тот, кто первым забьёт все шайбы своего цвета.", "The first player to pot all pucks of their color wins."],
    comboDouble: ["Дубль!", "Double!"],
    comboTriple: ["Тройной удар!", "Triple strike!"],
    tutDone: ["Готово", "Done"],
    tutTry: ["Попробовать", "Try It"],
    tutSkip: ["Пропустить", "Skip"],
    tutTryShot: ["Теперь сделайте удар: потяните кольцо от себя и отпустите", "Now take a shot: pull the ring back and release"],
    tutNext: ["Далее", "Next"],
    tutWaitShot: ["Отлично! Теперь удар…", "Great! Now take a shot…"],

    brokerProbe: ["Проверяем связь…", "Checking connection…"],
    brokerDown: ["Сервер стыковки недоступен из вашей сети — возможно, заблокирован провайдером. Используйте режим Wi-Fi.", "The signaling server is unreachable from your network — it may be blocked. Use the Wi-Fi mode instead."],
    btnCancel: ["Отмена", "Cancel"],
    labelCoins: ["АЛМАЗЫ", "DIAMONDS"],
    labelTable: ["РАСЦВЕТКА СТОЛА", "TABLE STYLE"],
    labelPucks: ["ШАЙБЫ", "PUCKS"],
    labelAvatars: ["АВАТАР", "AVATAR"],
    noRecord: ["Рекорда пока нет", "No record yet"],
    labelName: ["ИГРОК", "PLAYER"],
    namePh: ["Ваше имя", "Your name"],
    confirmExit: ["Выйти из игры?", "Exit the game?"],
    confirmReset: ["Начать заново?", "Start over?"],
    btnExit: ["Выйти", "Exit"],
    btnStay: ["Остаться", "Stay"],
    btnRestart: ["Начать заново", "Restart"],
    btnAgain: ["Ещё раз", "Play Again"],
    netOk: ["Интернет есть — онлайн-режим готов", "Internet is up — online ready"],
    netFail: ["Интернет недоступен — онлайн-режим может не работать", "Internet unavailable — online may not work"],
    adReserved: ["место для рекламы", "ad space"],
    shopSelect: ["ВЫБРАТЬ", "SELECT"],
    shopOwned: ["В ИГРЕ", "IN USE"],

    botThinking: ["БОТ ДУМАЕТ", "BOT IS THINKING"],
    netWaiting: ["Ждём соперника…", "Waiting for an opponent…"],
    diff0: ["Лёгкий", "Easy"], diff1: ["Средний", "Medium"], diff2: ["Сложный", "Hard"],
    chooseDiff: ["ВЫБЕРИТЕ СЛОЖНОСТЬ", "CHOOSE DIFFICULTY"],
    netSegNet: ["Интернет · код", "Internet · code"],
    netSegLan: ["Wi-Fi · локально", "Wi-Fi · local"],
    breakBest: ["Лучший удар: {n}", "Best shot: {n}"],
    lanTesting: ["Тестовый режим браузера", "Browser test mode"],
    connClosed: ["Соединение закрыто", "Connection closed"],
    btnStart: ["Начать", "Start"],
    swatchOwned: ["куплено", "owned"],
    swatchSelected: ["выбрано", "selected"],
    swatchBuy: ["КУПИТЬ · 100", "BUY · 100"],
    codeTaken: ["Код занят, пробуем другой…", "Code taken, trying another…"],
    codeLen: ["Код — 4 символа", "Code must be 4 characters"],
    connecting: ["Подключаемся…", "Connecting…"],
    oppLeft: ["Соперник отключился", "Opponent disconnected"],
    lanWaiting: ["Ждём соперника в этой сети Wi-Fi…", "Waiting for an opponent on this Wi-Fi…"],
    lanSearching: ["Ищем хосты в вашей сети…", "Looking for hosts on your network…"],
    lanEnterCode: ["Введите код, показанный на хосте", "Enter the code shown on the host"],
    lanNeedAddr: ["Введите адрес хоста", "Enter the host address"],
    errGeneric: ["Сетевая игра недоступна", "Network game unavailable"],
    errRoomFull: ["В комнате уже два игрока", "This room already has two players"],
    netRestoring: ["Восстанавливаем соединение… Партия сохранена", "Reconnecting… Your match is saved"],
    netRestored: ["Соединение восстановлено", "Connection restored"],
    netSyncing: ["Синхронизируем результат удара…", "Synchronizing shot result…"],
    hintOpponentTurn: ["Ход соперника", "Opponent's turn"],
    netUpdateRequired: ["Установите новую версию игры на оба устройства", "Install the latest game on both devices"],
    netExpired: ["Соединение отсутствовало более 3 минут. Создайте новую игру", "Disconnected for over 3 minutes. Create a new game"],
    errNoNet: ["Нет соединения: проверьте интернет на устройстве", "No connection: check the internet on your device"],
    errServer: ["Сервер подключения недоступен — попробуйте ещё раз через минуту", "The signaling server is unreachable — try again in a minute"],
    errNotFound: ["Игра с таким кодом не найдена — проверьте код", "No game with this code — double-check it"],
    errIncompatible: ["Браузер не поддерживает онлайн-игру", "This browser can't run the online game"],
    errBlocked: ["Сеть блокирует P2P-соединение — попробуйте другой Wi-Fi", "The network blocks P2P — try another Wi-Fi"],
    errLan: ["Ошибка локальной сети — проверьте Wi-Fi", "Local network error — check your Wi-Fi"],
    errLink: ["Ошибка связи: {n}", "Connection error: {n}"],
    rouletteSpin: ["КРУТИМ…", "SPINNING…"],
    winTitle: ["ПОБЕДА!", "VICTORY!"],
    dailyTitle: ["ЕЖЕДНЕВНАЯ НАГРАДА", "DAILY REWARD"],
    dailyGet: ["Получить", "Claim"],
    nameSaved: ["Имя сохранено", "Name saved"],
    avatarSaved: ["Аватарка сохранена", "Avatar saved"],
    confirmName: ["Сохранить новое имя?", "Save the new name?"],
    confirmAvatar: ["Выбрать эту аватарку?", "Use this avatar?"],
    btnSaveProfile: ["Сохранить", "Save"],
    btnCancelProfile: ["Отмена", "Cancel"],
    errLanPermission: ["Разрешите доступ к локальной сети для поиска игр", "Allow local network access to find games"],
    rouletteGo: ["МАТЧ!", "MATCH!"],
    rouletteVs: ["БОТ · {n}", "BOT · {n}"],
};

const api = {
    lang: RCStore.get("rc_lang") === "en" ? "en" : "ru",
    t(key, vars) {
        const pair = DYN[key];
        if (!pair) return key;
        let s = pair[this.lang === "en" ? 1 : 0];
        if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
        return s;
    },
    set(lang) {
        document.getElementById("celebration").classList.remove("show");
        this.lang = lang === "en" ? "en" : "ru";
        RCStore.set("rc_lang", this.lang);
        this.apply();
    },
    apply() {
        document.documentElement.lang = this.lang;
        const idx = this.lang === "en" ? 2 : 1;
        for (const [id, ru, en] of STATIC) {
            const el = document.getElementById(id);
            if (el) el.textContent = idx === 2 ? en : ru;
        }
        document.querySelectorAll("[data-i18n]").forEach(el => {
            const pair = DYN[el.dataset.i18n];
            if (pair) el.textContent = pair[idx - 1];
        });
        document.body.classList.toggle("lang-en", this.lang === "en");
        for (const [id, key] of [["btnSettingsGear", "settingsTitle"], ["btnLangRu", "russianLanguage"], ["btnLangEn", "englishLanguage"], ["btnBack", "exitTitle"], ["btnReset", "resetTitle"], ["btnNameOk", "saveNameTitle"], ["diffClose", "closeTitle"]]) {
            const el = document.getElementById(id);
            el.title = this.t(key);
            el.setAttribute("aria-label", this.t(key));
        }
        for (const id of ["soundClose", "progressClose"]) {
            document.getElementById(id).setAttribute("aria-label", this.t("closeTitle"));
        }
        if (global.RCChat) global.RCChat.refresh();
        document.getElementById("nameInput").placeholder = this.t("namePh");
        if (global.renderLanList) global.renderLanList();
        if (global.refreshSettingsScreen) global.refreshSettingsScreen();
        if (global.updateBar) global.updateBar();
        if (global.refreshHomeProfile) global.refreshHomeProfile();
    },
};

global.I18N = api;
const t = (k, v) => api.t(k, v);
global.t = t;

})(window);
