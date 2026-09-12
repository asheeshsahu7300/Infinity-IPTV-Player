import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";

import {
  View,
  StyleSheet,
  Animated,
  Platform,
  Image,
  ScrollView,
  useWindowDimensions,
} from "react-native";

import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  usePortalStore,
  Portal,
} from "../src/store/portalStore";

import { portalApi } from "../src/services/portalApi";
import { M3UApi } from "../src/services/m3uApi";
import { XtreamApi } from "../src/services/xtreamApi";

import LoadingOverlay from "../src/components/LoadingOverlay";

import { LinearGradient } from "expo-linear-gradient";

import {
  Focusable,
  FocusGroup,
} from "../src/tv";

import { useDialog } from "../src/components/ConfirmDialog";

import { isPhone } from "../src/utils/phoneUtils";
import { isTablet, isTouch } from "../src/utils/tabletUtils";

import {
  pw,
  ph,
  psRaw as ps,
  CARD_FRAME,
} from "../src/theme/tokens";

import { Plus } from "lucide-react-native";
import { DynamicIcon } from "../src/components/DynamicIcon";
import { Text } from "../src/components/Text";

/**
 * Height of the DELETE PORTAL button, in dp.
 *
 * `ph` is a percentage of the *short* edge, so `ph(5.5)` is 30dp against a TV's
 * 540 but only 22dp on a 393dp-wide handset — a control too short to hit. 44 is
 * the touch minimum.
 *
 * A constant because two places need the same number and they are far apart:
 * the button's own style, and `itemSize`, which sums the card, this button and
 * the gap to work out how tall one portal row is. They were separate copies of
 * `ph(5.5)`, so changing the button alone would have left the carousel
 * measuring rows at the old height.
 */
const DELETE_BTN_HEIGHT = isPhone ? 34 : ph(5.5);

/** Height of ADD NEW PORTAL, same reasoning — `ph(6.5)` is 26dp on a phone. */
const ADD_BTN_HEIGHT = isPhone ? 38 : ph(6.5);

export default function PortalsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    width: windowWidth,
    height: windowHeight,
  } = useWindowDimensions();

  // `!Platform.isTV`, not `isTablet` — the same expression every other screen
  // uses. Gated on `isTablet` this never fired on a phone, so a handset got the
  // side-by-side landscape portal grid in a 393dp-wide viewport.
  const isPortrait =
    !Platform.isTV && windowHeight > windowWidth;

  // ────────────────────────────────────────────────────────────────────────────
  // Dimensions
  // ────────────────────────────────────────────────────────────────────────────

  const portraitCardWidth = Math.max(
    0,
    windowWidth - 48
  );

  // `isTouch` throughout this block, not `isTablet`: these are the touch-layout
  // dimensions, and a phone needs them at least as much as a tablet does. On
  // `isTablet` a phone fell through to the TV branch, where `pw(28)` is 244dp
  // of a 393dp screen and `ph(45)` taller than the viewport.
  const cardWidth = isTouch
    ? isPortrait
      ? portraitCardWidth
      : Math.min(480, Math.max(273, windowWidth * 0.32))
    : pw(28);

  const cardMargin = isTouch
    ? isPortrait
      ? 0
      : 12
    : pw(1.5);

  /*
   * Portrait card height:
   *
   * Do not use a fixed 200px.
   * The card scales with the available portrait height,
   * while keeping a sensible maximum.
   */
  const cardHeight = isTouch
    ? isPortrait
      ? Math.min(260, Math.max(220, windowHeight * 0.30))
      : Math.min(465, Math.max(277, windowHeight * 0.52))
    : ph(45);

  /*
   * How far this panel is past the one the card was drawn for.
   *
   * The two caps above used to be flat 340 and 280, which both bite at around
   * a 1060dp panel: a 1506dp tablet was given the same 340x280 card as a
   * 1060dp one, so the card stopped being a third of the screen and became a
   * fifth of it, marooned in black. The 0.32/0.52 proportions were right, it
   * was only the ceilings that were not — they are now floors as well, so an
   * 853x533 tablet keeps the exact 273x277 it has, and the ceiling sits high
   * enough that roughly three cards still span the row on any panel.
   *
   * Type is damped against the box, the same trade as the guide: the tablet
   * type scale is panel-independent by design (`TABLET_PS_TARGET`), and card
   * text at the full 1.75x would tower over the same label everywhere else.
   * Undamped it would also be the wrong fix — the card grew because the panel
   * did, not because the words got longer.
   */
  const cardBoxScale =
    isTouch && !isPortrait ? Math.min(1.75, Math.max(1, cardWidth / 273)) : 1;
  const cardTypeScale = Math.min(1.4, Math.max(1, 1 + (cardBoxScale - 1) * 0.7));

  /*
   * The wordmark, against the short edge rather than a constant.
   *
   * `ph(8)` already grows the header it sits in, but the image box under it
   * was a flat 400x90, so the mark went from about three times the header's
   * height on an 853x533 panel to under twice on a 1506x941 one — it reads as
   * having shrunk even though nothing changed. Short edge, not `windowHeight`,
   * so a tablet held upright would not take a long edge as its measure.
   */
  const brandScale = isTablet
    ? Math.min(1.55, Math.max(1, Math.min(windowWidth, windowHeight) / 533))
    : 1;

  const deleteButtonHeight = DELETE_BTN_HEIGHT;

  const portraitItemGap = 32;

  /*
   * Complete vertical space occupied by one portrait item:
   *
   * card
   * + delete button margin
   * + delete button
   * + gap before next item
   */
  const itemSize = isPortrait
    ? cardHeight +
    ph(1.5) +
    deleteButtonHeight +
    portraitItemGap
    : cardWidth + cardMargin * 2;

  const spacerWidth = Math.max(
    0,
    (windowWidth - cardWidth) / 2
  );

  // ────────────────────────────────────────────────────────────────────────────
  // Store
  // ────────────────────────────────────────────────────────────────────────────

  const portals = usePortalStore(
    (s) => s.portals
  );

  const activePortal = usePortalStore(
    (s) => s.activePortal
  );

  const loadPortals = usePortalStore(
    (s) => s.loadPortals
  );

  const setActivePortal = usePortalStore(
    (s) => s.setActivePortal
  );

  const updatePortal = usePortalStore(
    (s) => s.updatePortal
  );

  const deletePortal = usePortalStore(
    (s) => s.deletePortal
  );

  // ────────────────────────────────────────────────────────────────────────────
  // State
  // ────────────────────────────────────────────────────────────────────────────

  const [isLoading, setIsLoading] =
    useState(false);

  const [loadingMessage, setLoadingMessage] =
    useState("");

  const [focusedPortalId, setFocusedPortalId] =
    useState<string | null>(null);

  const {
    open: openDialog,
    notify,
    close: closeDialog,
    node: dialogNode,
  } = useDialog();

  /*
   * scrollX is kept as the existing animated value.
   *
   * Landscape:
   *   X axis is used.
   *
   * Portrait:
   *   Scrolling is native vertical and does not
   *   drive the carousel animation.
   */
  const scrollX = useRef(
    new Animated.Value(0)
  ).current;

  const flatListRef = useRef<any>(null);

  const [
    shouldAutoTargetFirstPortal,
    setShouldAutoTargetFirstPortal,
  ] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShouldAutoTargetFirstPortal(false);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    loadPortals();
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // Connect
  // ────────────────────────────────────────────────────────────────────────────

  const connectToPortal = async (
    portal: Portal
  ) => {
    if (activePortal?.id === portal.id) {
      router.replace("/dashboard");
      return;
    }

    setIsLoading(true);
    setLoadingMessage("Connecting...");

    try {
      if (portal.type === "m3u") {
        const api = new M3UApi({
          url: portal.config.url,
        });

        const result = await api.login();

        if (!result.ok) {
          throw new Error(result.error);
        }

        await setActivePortal(portal);
        router.replace("/dashboard");
        return;
      }

      if (portal.type === "xtream") {
        const api = new XtreamApi({
          url: portal.config.url,
          username: portal.config.username!,
          password: portal.config.password!,
        });

        await api.login();

        await setActivePortal(portal);
        router.replace("/dashboard");
        return;
      }

      const {
        token,
        serverInfo,
      } = await portalApi.authenticate(
        portal
      );

      await updatePortal(portal.id, {
        config: {
          ...portal.config,
          token,
          serverInfo,
        },
      });

      await setActivePortal({
        ...portal,
        config: {
          ...portal.config,
          token,
          serverInfo,
        },
      });

      router.replace("/dashboard");
    } catch (e: any) {
      notify(
        "Connection Failed",
        e?.message ||
        "Unable to connect to this portal.",
        "danger"
      );
    } finally {
      setIsLoading(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Delete
  // ────────────────────────────────────────────────────────────────────────────

  const handleDeletePortal = useCallback(
    (portal: Portal) => {
      openDialog({
        id: `delete-portal:${portal.id}`,
        tone: "danger",
        icon: "trash-outline",
        title: "Delete Portal",
        message:
          `"${portal.name}" will be removed from this device. This cannot be undone.`,
        confirmLabel: "Delete",
        onConfirm: async () => {
          await deletePortal(portal.id);
          closeDialog();
        },
      });
    },
    [
      deletePortal,
      openDialog,
      closeDialog,
    ]
  );

  // ────────────────────────────────────────────────────────────────────────────
  // Portal type
  // ────────────────────────────────────────────────────────────────────────────

  const getPortalTypeInfo = (
    type: string
  ): { icon: string } => {
    switch (type) {
      case "m3u":
        return { icon: "list" };

      case "xtream":
        return { icon: "cloud" };

      case "mag":
        return { icon: "server" };

      default:
        return { icon: "server" };
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Card content
  // ────────────────────────────────────────────────────────────────────────────

  const renderCardContent = (
    item: Portal,
    isActive: boolean,
    isFocused: boolean
  ) => {
    const config = item.config || {};

    const detail =
      (config as any).url ||
      (config as any).mac ||
      "--";

    return (
      <LinearGradient
        colors={
          isFocused
            ? [
              "rgba(255,255,255,0.12)",
              "rgba(255,255,255,0.06)",
              "rgba(255,255,255,0.02)",
            ]
            : [
              "rgba(255,255,255,0.05)",
              "rgba(255,255,255,0.02)",
              "rgba(255,255,255,0.0)",
            ]
        }
        locations={[0, 0.5, 1]}
        style={[S.portalCardGradient, { padding: ps(2.6) * cardBoxScale }]}
      >
        <View style={S.cardHeader}>
          <View style={S.cardIconBox}>
            <DynamicIcon
              name={
                getPortalTypeInfo(
                  item.type
                ).icon
              }
              size={ps(3.2) * cardTypeScale}
              color={
                isFocused
                  ? "#FFFFFF"
                  : isActive
                    ? "#FFFFFF"
                    : "rgba(255,255,255,0.75)"
              }
            />
          </View>

          {isActive && (
            <View
              style={[
                S.activeBadge,
                isFocused &&
                S.activeBadgeFocused,
              ]}
            >
              <View
                style={[
                  S.badgeDot,
                  isFocused &&
                  S.badgeDotFocused,
                ]}
              />

              <Text
                style={[
                  S.activeBadgeText,
                  { fontSize: ps(1.05) * cardTypeScale },
                  isFocused &&
                  S.activeBadgeTextFocused,
                ]}
              >
                ACTIVE
              </Text>
            </View>
          )}
        </View>

        <View style={S.cardMain}>
          <Text
            style={[
              S.cardName,
              { fontSize: ps(2.8) * cardTypeScale },
              isFocused && {
                color: "#FFFFFF",
              },
            ]}
            numberOfLines={1}
          >
            {item.name}
          </Text>

          <Text
            style={[
              S.cardDetailText,
              { fontSize: ps(1.3) * cardTypeScale },
              isFocused && {
                color:
                  "rgba(255,255,255,0.9)",
              },
            ]}
            numberOfLines={1}
          >
            {detail}
          </Text>

          <Text
            style={[
              S.cardTypeLabel,
              { fontSize: ps(1.1) * cardTypeScale },
              isFocused && {
                color: "#FFFFFF",
              },
            ]}
          >
            {item.type === "m3u"
              ? "M3U PLAYLIST"
              : item.type === "xtream"
                ? "XTREAM CODES API"
                : "MAC PORTAL"}
          </Text>
        </View>
      </LinearGradient>
    );
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Portal item
  // ────────────────────────────────────────────────────────────────────────────

  const renderPortal = ({
    item,
    index,
  }: {
    item: Portal;
    index: number;
  }) => {
    const isColFocused =
      focusedPortalId === item.id;

    const isActive =
      activePortal?.id === item.id;

    const shouldFocus =
      index === 0 &&
      shouldAutoTargetFirstPortal;

    const inputRange = [
      (index - 1) * itemSize,
      index * itemSize,
      (index + 1) * itemSize,
    ];

    const scale = scrollX.interpolate({
      inputRange,
      outputRange: [
        0.95,
        1.05,
        0.95,
      ],
      extrapolate: "clamp",
    });

    const opacity = scrollX.interpolate({
      inputRange,
      outputRange: [
        0.7,
        1,
        0.7,
      ],
      extrapolate: "clamp",
    });

    const useStaticFocus =
      portals.length <= 3;

    return (
      <Animated.View
        key={item.id}
        style={[
          S.cardWrapper,
          {
            width: cardWidth,
            marginHorizontal: cardMargin,
            height: cardHeight,

            transform: [
              {
                scale: useStaticFocus
                  ? isColFocused
                    ? 1.04
                    : 1
                  : scale,
              },
            ],

            opacity: useStaticFocus
              ? isColFocused
                ? 1
                : 0.85
              : opacity,

            zIndex: isColFocused
              ? 100
              : index,
          },
        ]}
      >
        <FocusGroup
          style={{
            flex: 1,
          }}
        >
          <Focusable
            hasTVPreferredFocus={
              shouldFocus
            }
            screenKey="portals"
            focusKey={`card-${item.id}`}
            onFocus={() => {
              setFocusedPortalId(
                item.id
              );

              flatListRef.current?.scrollToIndex(
                {
                  index,
                  animated: true,
                  viewPosition: 0.5,
                }
              );
            }}
            onPress={() =>
              connectToPortal(item)
            }
            ringOnFocus={false}
            style={S.pressable}
          >
            {(focused) => (
              <View
                style={[
                  S.portalCard,
                  focused &&
                  S.portalCardFocused,
                  isActive &&
                  S.portalCardActive,
                  isActive &&
                  focused &&
                  S.portalCardActiveFocused,
                ]}
              >
                {renderCardContent(
                  item,
                  isActive,
                  focused
                )}
              </View>
            )}
          </Focusable>

          <Focusable
            screenKey="portals"
            focusKey={`delete-${item.id}`}
            onFocus={() => {
              setFocusedPortalId(
                item.id
              );
            }}
            onPress={() =>
              handleDeletePortal(item)
            }
            style={
              S.deleteBtnWrapper
            }
            ringOnFocus={false}
          >
            {(focusedBtn) => (
              <View
                style={[
                  S.deleteBtn,
                  focusedBtn &&
                  S.deleteBtnFocused,
                ]}
              >
                <Text
                  style={[
                    S.deleteBtnText,
                    !isPhone && { fontSize: ps(1.15) * cardTypeScale },
                    focusedBtn &&
                    S.deleteBtnTextFocused,
                  ]}
                >
                  DELETE PORTAL
                </Text>
              </View>
            )}
          </Focusable>
        </FocusGroup>
      </Animated.View>
    );
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Header
  // ────────────────────────────────────────────────────────────────────────────

  const renderHeader = () => (
    <View
      style={[
        S.header,
        isTouch && {
          marginTop: ph(4),
          height: ph(8),
          marginBottom: ph(1),
        },
        /*
         * `ph(8)` is 31dp on a handset — shorter than the logo it has to hold,
         * so the mark overflowed its own header.
         *
         * Flush: this is exactly the logo's height with 0 margins either side,
         * so the header adds nothing of its own. It has to move in step with
         * the `isPhone` height on the Image below — that is the only thing left
         * that sets how much vertical space the branding takes.
         */
        isPhone && {
          marginTop: 0,
          height: 76,
          marginBottom: 0,
        },
      ]}
    >
      <Image
        source={require("../assets/images/TV.webp")}
        style={[
          S.headerLogoImage,
          isTablet && {
            width: Math.round(400 * brandScale),
            height: Math.round(90 * brandScale),
            transform: [
              {
                scale: 1.4,
              },
            ],
          },
          /*
           * The phone box is 3:2, the asset's own ratio, so `contain` fills it
           * exactly and `scale: 1` leaves layout and paint in agreement.
           *
           * That is what the previous 200x46 got wrong: `contain` fits inside
           * the box before the transform, and a box that wide and short is
           * *height*-limited — so the mark rendered at 69x46 and the scale only
           * took it to 79x53, a third of the width the box claimed. Sizing the
           * box to the artwork instead makes the numbers here the real ones.
           */
          isPhone && {
            width: 114,
            height: 76,
            transform: [{ scale: 1 }],
          },
        ]}
        resizeMode="contain"
      />
    </View>
  );

  // ────────────────────────────────────────────────────────────────────────────
  // Add button
  // ────────────────────────────────────────────────────────────────────────────

  const renderAddButton = () => (
    <FocusGroup style={S.actionArea}>
      <Focusable
        screenKey="portals"
        focusKey="add-portal-btn"
        ringOnFocus={false}
        onPress={() =>
          router.push(
            "/add-portal"
          )
        }
        style={{
          borderRadius: 18,
          overflow: "visible",
        }}
      >
        {(focused) => (
          <View
            style={[
              S.addBtn,
              focused &&
              S.addBtnFocused,
            ]}
          >
            <Plus
              size={ps(1.6)}
              color={
                isPhone || focused
                  ? "#000000"
                  : "#FFFFFF"
              }
            />

            <Text
              style={[
                S.addBtnText,
                !isPhone && { fontSize: ps(1.2) * cardTypeScale },
                focused &&
                S.addBtnTextFocused,
              ]}
            >
              ADD NEW PORTAL
            </Text>
          </View>
        )}
      </Focusable>
    </FocusGroup>
  );

  // ────────────────────────────────────────────────────────────────────────────
  // Empty state
  // ────────────────────────────────────────────────────────────────────────────

  const renderEmptyState = () => (
    <View
      style={[
        S.introRow,
        /*
         * Portrait stacks the copy above the artwork.
         *
         * `alignItems: "stretch"` matters as much as the direction: the base
         * row centres its children, and a centred column child sizes to its
         * content rather than to the column, which leaves the artwork free to
         * be as wide as its aspect ratio asks for. See `introArt` below.
         */
        isPortrait && {
          flexDirection: "column",
          alignItems: "stretch",
          // The gap is the only thing between the GET STARTED button and the
          // top of the artwork stack — the copy block ends flush with the
          // button, and the back layer of the stack starts at `top: 0`.
          gap: 40,
          paddingVertical: 24,
          paddingHorizontal: 24,
        },
      ]}
    >
      <View style={[S.introCopy, isPortrait && { flex: 0, width: "100%" }]}>
        <Image
          source={require("../assets/images/TV.webp")}
          style={S.introLogo}
          resizeMode="contain"
        />

        <Text style={S.introTitle}>
          Unlimited Entertainment
        </Text>

        <Text style={S.introBody}>
          Connect your first streaming source
          to reach thousands of channels,
          global movies and exclusive series —
          all on this screen.
        </Text>

        <Focusable
          hasTVPreferredFocus
          ringOnFocus={false}
          onPress={() =>
            router.push(
              "/add-portal"
            )
          }
          style={
            S.getStartedWrapper
          }
        >
          {(focused) => (
            <View
              style={[
                S.addButtonLarge,
                focused &&
                S.addButtonLargeFocused,
              ]}
            >
              <Text
                style={[
                  S.addButtonText,
                  focused && {
                    color: "#000",
                  },
                ]}
              >
                GET STARTED
              </Text>
            </View>
          )}
        </Focusable>
      </View>

      {/*
        * `flex: 0` and a full width in portrait, so the aspect ratio derives
        * the height from the width instead of the other way round.
        *
        * `introArt` is `flex: 1.1` with `aspectRatio: 16/10`. In the landscape
        * row that shares the width and the ratio gives a height. Turned into a
        * column it shares the *height* instead — a tall portrait screen hands
        * it a large one — and the ratio then asks for 1.6x that in width, so
        * the artwork ran off both edges and took its absolutely-positioned
        * layers with it.
        */}
      <View style={[S.introArt, isPortrait && { flex: 0, width: "100%" }]}>
        <Image
          source={require("../assets/images/series.webp")}
          style={[
            S.introArtLayer,
            S.introArtBack,
          ]}
          resizeMode="cover"
        />

        <Image
          source={require("../assets/images/movies.webp")}
          style={[
            S.introArtLayer,
            S.introArtMid,
          ]}
          resizeMode="cover"
        />

        <Image
          source={require("../assets/images/livetv.webp")}
          style={[
            S.introArtLayer,
            S.introArtFront,
          ]}
          resizeMode="cover"
        />
      </View>
    </View>
  );

  // ────────────────────────────────────────────────────────────────────────────
  // Empty
  // ────────────────────────────────────────────────────────────────────────────

  if (portals.length === 0) {
    return (
      <View
        style={[
          S.container,
          {
            paddingTop: insets.top,
            paddingBottom: isTouch
              ? insets.bottom + 16
              : 0,
          },
        ]}
      >
        {isLoading && (
          <LoadingOverlay
            message={loadingMessage}
          />
        )}

        {renderEmptyState()}

        {dialogNode}
      </View>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Root
  // ────────────────────────────────────────────────────────────────────────────

  return (
    <View
      style={[
        S.container,
        {
          paddingTop: insets.top,
          paddingBottom: isTouch
            ? insets.bottom + 16
            : 0,
        },
      ]}
    >
      {isLoading && (
        <LoadingOverlay
          message={loadingMessage}
        />
      )}

      {renderHeader()}

      <View
        style={S.carouselContainer}
      >
        {portals.length <= 3 ? (
          <ScrollView
            contentContainerStyle={[
              S.centeredGrid,

              isPortrait && {
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 24,
                // The 24 above the first card stacked on the header's own
                // margin and the carousel's padding, so the portal sat well
                // down the screen with nothing between it and the logo.
                paddingVertical: isPhone ? 8 : 24,
                gap: portraitItemGap,
              },

              isTouch &&
              !isPortrait && {
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                flexGrow: 1,
              },
            ]}
            showsVerticalScrollIndicator={
              false
            }
          >
            {portals.map(
              (item, index) =>
                renderPortal({
                  item,
                  index,
                })
            )}
          </ScrollView>
        ) : (
          <Animated.FlatList
            ref={flatListRef}
            data={portals}

            /*
             * Landscape:
             * horizontal carousel.
             *
             * Portrait:
             * vertical scrolling list.
             */
            horizontal={!isPortrait}

            showsHorizontalScrollIndicator={
              false
            }

            showsVerticalScrollIndicator={
              false
            }

            /*
             * Snap only in landscape.
             */
            snapToInterval={
              isPortrait
                ? undefined
                : itemSize
            }

            decelerationRate="fast"

            contentContainerStyle={[
              S.carouselList,

              isPortrait
                ? {
                  width: "100%",
                  alignItems: "center",
                  paddingHorizontal: 24,
                  paddingVertical: 24,
                  gap: portraitItemGap,
                }
                : {
                  flexGrow: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: spacerWidth,
                },
            ]}

            /*
             * Animated X scrolling is only needed
             * for the landscape carousel.
             *
             * Portrait uses normal native vertical
             * scrolling, which fixes vertical scrolling
             * and avoids using the wrong axis.
             */
            onScroll={
              isPortrait
                ? undefined
                : Animated.event(
                  [
                    {
                      nativeEvent: {
                        contentOffset: {
                          x: scrollX,
                        },
                      },
                    },
                  ],
                  {
                    useNativeDriver: true,
                  }
                )
            }

            scrollEventThrottle={16}

            renderItem={
              renderPortal
            }

            keyExtractor={(item) =>
              item.id
            }

            /*
             * Let FlatList calculate portrait
             * positions naturally because the
             * portrait item contains the card,
             * delete button and spacing.
             */
            getItemLayout={
              isPortrait
                ? undefined
                : (_, index) => ({
                  length: itemSize,
                  offset:
                    itemSize *
                    index,
                  index,
                })
            }
          />
        )}
      </View>

      {portals.length > 0 &&
        renderAddButton()}

      {dialogNode}
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Styles
// ───────────────────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  // ── Root ──────────────────────────────────────────────────────────────────

  container: {
    flex: 1,
    backgroundColor: "#000000",
  },

  // ── Header ────────────────────────────────────────────────────────────────

  header: {
    alignItems: "center",
    justifyContent: "center",
    height: ph(11),
    marginTop: ph(9.5),
    marginBottom: ph(2),
  },

  headerLogoImage: {
    width: pw(46),
    height: ph(11),
    transform: [
      {
        scale: 2.6,
      },
    ],
  },

  // ── Add button ────────────────────────────────────────────────────────────

  actionArea: {
    alignItems: "center",
    paddingBottom: ph(5),
    marginTop: ph(1.5),
  },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: ADD_BTN_HEIGHT,
    // `pw` is a percentage of the *long* edge, so `pw(3)` is 26dp a side on a
    // handset — most of the button once the label is in it.
    paddingHorizontal: isPhone ? 18 : pw(3),
    borderRadius: 18,
    // White for the same reason as `deleteBtn`: the dark fill is a resting
    // state that only a remote's focus ever lifts.
    backgroundColor: isPhone ? "#F5F5F5" : "#17181c",
    borderWidth: 0,
    borderColor: "transparent",
    gap: isPhone ? 8 : pw(0.8),
  },

  addBtnFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,

    transform: [
      {
        scale: 1.04,
      },
    ],

    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: {
          width: 0,
          height: 0,
        },
        shadowOpacity: 0.8,
        shadowRadius: 16,
      },

      android: {
        elevation: 10,
      },
    }),
  },

  addBtnText: {
    color: isPhone ? "#000000" : "#FFFFFF",
    fontSize: isPhone ? 12.5 : ps(1.2),
    fontWeight: "800",
    letterSpacing: 1.2,
  },

  addBtnTextFocused: {
    color: "#000000",
    fontWeight: "900",
  },

  // ── Carousel ──────────────────────────────────────────────────────────────

  carouselContainer: {
    flex: 1,
    paddingVertical: isPhone ? 4 : ph(2),
    justifyContent: "center",
    alignItems: "stretch",
  },

  carouselList: {
    alignItems: "center",
  },

  centeredGrid: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },

  // ── Card wrapper ──────────────────────────────────────────────────────────

  cardWrapper: {
    alignSelf: "center",
  },

  pressable: {
    flex: 1,
    borderRadius: 18,
    overflow: "hidden",
  },

  // ── Portal card ───────────────────────────────────────────────────────────

  portalCard: {
    flex: 1,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#17181c",
    borderWidth: 1,
    borderColor: "transparent",
  },

  portalCardFocused: {
    borderColor: "#FFFFFF",
    borderWidth: 1,
    backgroundColor:
      "rgba(255, 255, 255, 0.12)",

    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: {
          width: 0,
          height: 0,
        },
        shadowOpacity: 0.6,
        shadowRadius: 16,
      },

      android: {
        elevation: 6,
      },
    }),
  },

  portalCardActive: {
    borderColor:
      "rgba(255, 255, 255, 0.25)",
  },

  portalCardActiveFocused: {
    borderColor: "#FFFFFF",
    borderWidth: 2,
    backgroundColor:
      "rgba(255, 255, 255, 0.12)",

    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: {
          width: 0,
          height: 0,
        },
        shadowOpacity: 0.6,
        shadowRadius: 16,
      },

      android: {
        elevation: 6,
      },
    }),
  },

  portalCardGradient: {
    flex: 1,
    padding: ps(2.6),
    justifyContent: "space-between",
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  cardIconBox: {
    justifyContent: "center",
    alignItems: "center",
  },

  // ── Active badge ──────────────────────────────────────────────────────────

  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: pw(0.5),
  },

  activeBadgeFocused: {},

  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#4ADE80",
  },

  badgeDotFocused: {
    backgroundColor: "#4ADE80",
  },

  activeBadgeText: {
    color: "#FFFFFF",
    fontSize: ps(1.05),
    fontWeight: "800",
    letterSpacing: 1.2,
  },

  activeBadgeTextFocused: {
    color: "#FFFFFF",
  },

  // ── Card body ─────────────────────────────────────────────────────────────

  cardMain: {
    flex: 1.5,
    justifyContent: "center",
  },

  cardName: {
    fontSize: ps(2.8),
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: ph(0.6),
    letterSpacing: 0.5,
  },

  cardDetailText: {
    fontSize: ps(1.3),
    color: "rgba(255, 255, 255, 0.65)",
    fontWeight: "500",
    marginBottom: ph(1.2),
    letterSpacing: 0.3,
  },

  cardTypeLabel: {
    fontSize: ps(1.1),
    color: "rgba(255, 255, 255, 0.5)",
    fontWeight: "800",
    letterSpacing: 2,
  },

  // ── Delete button ─────────────────────────────────────────────────────────

  deleteBtnWrapper: {
    marginTop: ph(1.5),
    borderRadius: 18,
    overflow: "visible",
  },

  deleteBtn: {
    height: DELETE_BTN_HEIGHT,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    // White on a phone. The dark fill is the *resting* state of a control that
    // turns white when a remote focuses it — and a phone never focuses
    // anything, so it would have sat dark forever.
    backgroundColor: isPhone ? "#F5F5F5" : "#17181c",
    borderWidth: 0,
    borderColor: "transparent",
  },

  deleteBtnFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,

    transform: [
      {
        scale: 1.03,
      },
    ],

    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: {
          width: 0,
          height: 0,
        },
        shadowOpacity: 0.6,
        shadowRadius: 12,
      },

      android: {
        elevation: 6,
      },
    }),
  },

  deleteBtnText: {
    // Dark ink to match the white fill above; white text on it is invisible.
    color: isPhone
      ? "#000000"
      : "rgba(255, 255, 255, 0.95)",
    fontSize: isPhone ? 12.5 : ps(1.15),
    fontWeight: "700",
    letterSpacing: 1.5,
  },

  deleteBtnTextFocused: {
    color: "#000000",
    fontWeight: "900",
  },

  // ── Empty state ───────────────────────────────────────────────────────────

  introRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: pw(6),
    paddingVertical: ph(4),
    gap: pw(5),
  },

  introCopy: {
    flex: 1,
    alignItems: "flex-start",
  },

  introLogo: {
    width: isPhone ? 180 : pw(20),
    height: (isPhone ? 180 : pw(20)) / 1.5,
    marginBottom: ph(3),
  },

  introTitle: {
    fontSize: ps(3),
    color: "#F5F5F7",
    fontWeight: "600",
    letterSpacing: 0.5,
  },

  introBody: {
    fontSize: ps(1.4),
    lineHeight: ps(2.2),
    color: "#9A9DA5",
    marginTop: ph(2),
    maxWidth: pw(38),
  },

  getStartedWrapper: {
    borderRadius: 18,
    overflow: "visible",
    alignSelf: "flex-start",
    marginTop: ph(5),
  },

  introArt: {
    flex: 1.1,
    aspectRatio: 16 / 10,
  },

  introArtLayer: {
    position: "absolute",
    width: "88%",
    height: "80%",
    ...CARD_FRAME,
  },

  introArtBack: {
    top: 0,
    left: "12%",
    opacity: 0.45,
  },

  introArtMid: {
    top: "10%",
    left: "6%",
    opacity: 0.75,
  },

  introArtFront: {
    top: "20%",
    left: 0,
  },

  addButtonLarge: {
    paddingHorizontal: pw(2.5),
    paddingVertical: ph(1.5),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#17181c",
    borderWidth: 0,
    borderColor: "transparent",
  },

  addButtonLargeFocused: {
    backgroundColor: "#F5F5F5",
    borderColor: "transparent",
    borderWidth: 0,

    transform: [
      {
        scale: 1.06,
      },
    ],

    ...Platform.select({
      ios: {
        shadowColor: "#FFFFFF",
        shadowOffset: {
          width: 0,
          height: 0,
        },
        shadowOpacity: 0.6,
        shadowRadius: 14,
      },

      android: {
        elevation: 8,
      },
    }),
  },

  addButtonText: {
    color: "#F5F5F7",
    fontSize: ps(1.4),
    fontWeight: "700",
    letterSpacing: 1.5,
  },
});