/**
 * Wall pictures in a joined room (#46, SPEC §9.4): every picture in the
 * room's OperationRoom state (`decor`) on its wall, live for everyone on it.
 * In the room the player is in, whoever may change a picture (its placer,
 * the room's managers) clicks it to select it: corner handles resize it,
 * dragging its face moves it (also onto the other full wall), and the HUD
 * dock removes it. While a picture is being hung, its ghost follows the
 * pointer, green where it fits and red where it does not.
 */
import type { ThreeEvent } from "@react-three/fiber";
import type { DecorState } from "@regulus/protocol";
import { type RoomTemplate, wallById } from "@regulus/room-layout";
import { useEffect, useState } from "react";
import { useMayEditPicture } from "../../ui/pictures/access.ts";
import { type Editing, usePicturesStore } from "../../ui/pictures/picturesStore.ts";
import { anchorPlacement } from "../furniture/placement.ts";
import { LAIR } from "../lair/palette.ts";
import { type RoomScope, scopedName, useRoomScope } from "../roomScope.ts";
import { PICTURE_BORDER, PictureLook } from "./PictureLook.tsx";
import { type DragKind, PlacingPointer, useDragPicture } from "./PicturePointer.tsx";
import type { PictureDraft } from "./pictureGeometry.ts";
import { usePictureTexture } from "./pictureTexture.ts";

const OK = "#3BD16F";
const HANDLE = 0.09;
const noHit = () => null;

function Placed({
  template,
  scope,
  draft,
  name,
  children,
}: {
  template: RoomTemplate;
  scope: RoomScope;
  draft: PictureDraft;
  name: string;
  children: React.ReactNode;
}) {
  const wall = wallById(template, draft.wallId);
  if (!wall) return null;
  const p = anchorPlacement(
    wall,
    { t: draft.x, y: draft.y, w: draft.w, h: draft.h },
    scope.wallDepth,
  );
  return (
    <group position={p.position as [number, number, number]} rotation-y={p.rotationY} name={name}>
      {children}
    </group>
  );
}

function Picture({
  template,
  scope,
  decor,
  editing,
}: {
  template: RoomTemplate;
  scope: RoomScope;
  decor: DecorState;
  editing: Editing | null;
}) {
  const texture = usePictureTexture(decor.imageUrl || null);
  const mayEdit = useMayEditPicture(scope.operationId, decor.placedBy) && scope.interactive;
  const [hover, setHover] = useState(false);
  const drag = useDragPicture(template, scope);
  const selected = editing?.decorId === decor.id;
  const shown: PictureDraft = selected && editing?.draft ? editing.draft : decor;
  const bad = selected && editing?.verdict && !editing.verdict.ok;
  // The server took the move: the state caught up with the draft.
  useEffect(() => {
    if (!selected || !editing?.draft || editing.dragging) return;
    const d = editing.draft;
    if (
      d.wallId === decor.wallId &&
      d.x === decor.x &&
      d.y === decor.y &&
      d.w === decor.w &&
      d.h === decor.h
    )
      usePicturesStore.getState().setDraft(null, null);
  }, [selected, editing, decor]);
  const startDrag = (kind: DragKind) => (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0 || !mayEdit) return;
    e.stopPropagation();
    if (!selected) usePicturesStore.getState().select(scope.operationId ?? "", decor.id);
    drag(kind, shown, decor.id, e.nativeEvent.clientX, e.nativeEvent.clientY);
  };
  const name = scopedName(scope, `picture-${decor.id}`);
  return (
    <Placed template={template} scope={scope} draft={shown} name={name}>
      <PictureLook
        w={shown.w}
        h={shown.h}
        texture={texture}
        tint={bad ? LAIR.red : selected ? LAIR.yellow : hover && mayEdit ? LAIR.yellow : null}
      />
      {mayEdit && (
        <mesh
          name={`${name}-hotspot`}
          visible={false}
          position={[0, 0, 0.05]}
          onPointerDown={startDrag("move")}
          onClick={(e) => e.stopPropagation()}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHover(true);
            document.body.style.cursor = selected ? "move" : "pointer";
          }}
          onPointerOut={() => {
            setHover(false);
            document.body.style.cursor = "";
          }}
        >
          <boxGeometry args={[shown.w + 2 * PICTURE_BORDER, shown.h + 2 * PICTURE_BORDER, 0.1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
      {selected &&
        mayEdit &&
        [-1, 1].flatMap((sx) =>
          [-1, 1].map((sy) => (
            <mesh
              key={`${sx}${sy}`}
              name={`${name}-handle-${sx > 0 ? "r" : "l"}${sy > 0 ? "t" : "b"}`}
              position={[
                sx * (shown.w / 2 + PICTURE_BORDER),
                sy * (shown.h / 2 + PICTURE_BORDER),
                0.115,
              ]}
              onPointerDown={startDrag("resize")}
              onClick={(e) => e.stopPropagation()}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = sx === sy ? "nesw-resize" : "nwse-resize";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "";
              }}
            >
              <boxGeometry args={[HANDLE, HANDLE, 0.02]} />
              <meshBasicMaterial color={LAIR.yellow} toneMapped={false} />
            </mesh>
          )),
        )}
    </Placed>
  );
}

function Ghost({ template, scope }: { template: RoomTemplate; scope: RoomScope }) {
  const mode = usePicturesStore((s) => (s.mode.kind === "placing" ? s.mode : null));
  const texture = usePictureTexture(mode?.previewUrl ?? null);
  if (!mode?.draft) return null;
  return (
    <Placed template={template} scope={scope} draft={mode.draft} name="picture-ghost">
      <group raycast={noHit}>
        <PictureLook
          w={mode.draft.w}
          h={mode.draft.h}
          texture={texture}
          tint={mode.verdict?.ok ? OK : LAIR.red}
          opacity={0.8}
        />
      </group>
    </Placed>
  );
}

/** The pictures of the operation room in scope (RoomScope). */
export function PictureLayer({ template }: { template: RoomTemplate }) {
  const scope = useRoomScope();
  const decor = scope.store((s) => s.state?.decor);
  const editing = usePicturesStore((s) =>
    s.mode.kind === "editing" && s.mode.operationId === scope.operationId ? s.mode : null,
  );
  const placing = usePicturesStore(
    (s) => s.mode.kind === "placing" && s.mode.operationId === scope.operationId,
  );
  const pictures = Object.values(decor ?? {}).filter((d) => d.kind === "picture");
  return (
    <group name={scopedName(scope, "pictures")}>
      {pictures.map((d) => (
        <Picture key={d.id} template={template} scope={scope} decor={d} editing={editing} />
      ))}
      {scope.interactive && placing && (
        <>
          <PlacingPointer template={template} scope={scope} />
          <Ghost template={template} scope={scope} />
        </>
      )}
    </group>
  );
}
