sed -i '' -e '1205,1210d' src/renderer/app.test.ts
cat << 'INNER_EOF' >> tmp_insert.js
      expect(mockRespond).toHaveBeenCalledWith({
          requestId: 'req-56',
          submitted: true,
          answers: { 'q56': ['Hello'] }
      });
INNER_EOF
sed -i '' -e '1204r tmp_insert.js' src/renderer/app.test.ts
rm tmp_insert.js
